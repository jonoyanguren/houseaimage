# houseaimage

Genera vídeos promocionales de inmuebles a partir de las fotos del anuncio.

## La idea

Los modelos image-to-video toman **un** fotograma inicial y devuelven un clip
de unos segundos. No existe un "mete 10 fotos y sale un vídeo": eso hay que
construirlo.

Así que la unidad de trabajo es el **clip**, no el anuncio:

```
10 fotos  →  10 jobs en paralelo  →  10 clips  →  1 montaje
             (fan-out)               (polling)    (compose)
```

Cada foto se envía como su propio job, se sondea por separado, y los clips que
terminan bien se montan en el orden que eligió el usuario. Un clip que falla no
tumba el lote: se reintenta, y si aun así no sale, el montaje se hace con el
resto (`partial`) en vez de perderlo todo.

## Arranque

```bash
npm install
npm run dev
```

No hace falta configurar nada. Sin `HIGGSFIELD_API_KEY`, la app usa el
**proveedor simulado**: los clips pasan por cola → generando → listo con
tiempos realistas, pero no se renderiza nada. En el montaje verás la foto con
un paneo lento y la etiqueta "Simulado", nunca un vídeo falso.

Para renders reales:

```bash
cp .env.example .env.local   # y rellena HIGGSFIELD_API_KEY
```

## Flujo

1. El usuario arrastra las fotos ([`PhotoDropzone`](src/components/PhotoDropzone.tsx))
   y las ordena. **Ese orden es el del vídeo final.**
2. `POST /api/upload` las guarda y devuelve URLs absolutas.
3. `POST /api/generate` hace el fan-out: N fotos → N jobs. Devuelve un
   `batchId` sin esperar al render.
4. El cliente sondea `GET /api/generate/[batchId]`. Cada llamada refresca los
   clips no terminados y reintenta los fallidos.
5. Cuando todos terminan, [`compose.ts`](src/lib/compose.ts) construye el
   *reel* y [`ReelPlayer`](src/components/ReelPlayer.tsx) lo reproduce
   encadenando los clips.
6. Si quedaron clips fallidos, `POST /api/generate/[batchId]` reintenta **solo
   esos**, sin volver a pagar los que ya salieron.

## Estados de un lote

| Estado | Significado |
| --- | --- |
| `processing` | Queda al menos un clip en cola o generando. |
| `completed` | Todos los clips salieron bien. |
| `partial` | Todos terminaron, algunos fallaron. Hay montaje con los que sobrevivieron. |
| `failed` | Todos terminaron y ninguno sirve. |

## Estructura

```
src/
  app/
    page.tsx                        # UI principal
    api/upload/route.ts             # sube fotos → URLs
    api/generate/route.ts           # POST: fan-out del lote
    api/generate/[batchId]/route.ts # GET: estado · POST: reintentar fallidos
  components/
    PhotoDropzone.tsx               # drag & drop + reordenar
    ClipProgressList.tsx            # progreso por clip
    ReelPlayer.tsx                  # reproduce el montaje
  lib/
    pipeline.ts                     # fan-out, polling, reintentos
    compose.ts                      # montaje y estado derivado del lote
    jobStore.ts                     # lotes en memoria (ver aviso abajo)
    providers/
      index.ts                      # selección de proveedor
      higgsfield.ts                 # proveedor real
      mock.ts                       # proveedor simulado
    concurrency.ts                  # map con concurrencia limitada
    config.ts                       # tunables por variable de entorno
    storage.ts                      # guardado de fotos
  types/video.ts                    # tipos del dominio
```

## Configuración

Todo en [`src/lib/config.ts`](src/lib/config.ts), ajustable por entorno. Los
que importan:

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `VIDEO_PROVIDER` | auto | `mock` o `higgsfield`. Sin valor: higgsfield si hay API key, si no mock. |
| `MAX_PHOTOS_PER_BATCH` | 20 | Cada foto es un job: esto acota el gasto. |
| `CREATE_CONCURRENCY` | 4 | Jobs creados a la vez. Subirlo invita a un 429. |
| `POLL_CONCURRENCY` | 6 | Consultas de estado en paralelo. |
| `MAX_CLIP_ATTEMPTS` | 2 | Reintentos automáticos por clip. |
| `MOCK_FAILURE_RATE` | 0 | Fracción de fallos simulados, para probar `partial` y reintentos. |

Para ver el camino de fallo:

```bash
MOCK_FAILURE_RATE=0.4 npm run dev
```

## ⚠️ Antes de producción

- **Endpoints de Higgsfield**: las rutas y nombres de campo en
  [`providers/higgsfield.ts`](src/lib/providers/higgsfield.ts) son un
  placeholder razonable. Confírmalos contra la documentación de tu cuenta.
  Todo lo demás es agnóstico del proveedor, así que corregirlos es un cambio de
  un solo archivo.
- **`jobStore` es memoria de un proceso**: en serverless o con varias
  instancias, dos sondeos consecutivos pueden caer en procesos distintos y dar
  404. Sustitúyelo por Redis/Postgres/KV antes de desplegar.
- **`storage.ts` escribe en disco local** (`public/uploads`). En serverless
  cambia a S3, Cloudinary o Vercel Blob. Además el proveedor descarga las URLs
  él mismo, así que en producción tienen que ser públicas de verdad.
- **El montaje es una playlist**, no un fichero. El cliente encadena los clips.
  Para un MP4 descargable hace falta concatenar de verdad (ffmpeg en un worker,
  o un servicio tipo Shotstack/Creatomate/Mux); el hueco está marcado en
  [`compose.ts`](src/lib/compose.ts).
