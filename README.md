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

## Inmuebles, estilos y escenas

El prompt de cada clip se compone de **tres** decisiones, no de una:

```
estilo (todo el reel) × inmueble (qué edificio) × escena (esta foto) → prompt
```

Un solo eje no basta: el movimiento correcto depende de la estancia (el paneo
lateral que favorece una encimera destroza el espejo de un baño) y del tipo de
inmueble ("orbitar la fachada" no significa nada en un tercer piso).

**Tipo de inmueble** ([`src/lib/prompts/properties.ts`](src/lib/prompts/properties.ts))
— piso, casa/chalet, ático, finca rústica y obra nueva. Sitúa al modelo, ordena
los estilos recomendados y decide qué estancias se ofrecen primero. Nunca oculta
opciones, solo las reordena.

**Estilos** ([`src/lib/prompts/styles.ts`](src/lib/prompts/styles.ts)) — cada
uno fija también formato y duración, que es la parte con consecuencias:

| Estilo | Formato | Clip | Para |
| --- | --- | --- | --- |
| Cinematográfico | 16:9 | 7s | Obra nueva de lujo, villas, portales premium |
| Dron / aéreo | 16:9 | 8s | Chalets, fincas, parcelas, edificios |
| Dinámico / social | 9:16 | 4s | Reels y TikTok, alquiler joven |
| Visita guiada | 16:9 | 5s | Pisos, visitas virtuales |
| Editorial | 4:5 | 6s | Interiorismo, arquitectura de autor |
| Lifestyle turístico | 9:16 | 5s | Alquiler vacacional, Airbnb |

**Escenas** ([`src/lib/prompts/scenes.ts`](src/lib/prompts/scenes.ts)) — trece
tipos (fachada, salón, cocina, dormitorio, baño, terraza, piscina, vistas,
jardín, distribuidor, detalle, zonas comunes, genérico), cada uno con su
movimiento de cámara. Se preseleccionan por posición y el usuario los corrige.

El catálogo se sirve al cliente en `GET /api/styles` **sin** el texto que lee el
modelo. Ese texto va en inglés (los modelos siguen el vocabulario de cámara
inglés mucho mejor) y no debe viajar al navegador.

## Flujo

1. El usuario arrastra las fotos ([`PhotoDropzone`](src/components/PhotoDropzone.tsx)),
   las ordena y marca qué es cada una. **Ese orden es el del vídeo final.**
2. `POST /api/upload` las guarda y devuelve URLs absolutas.
3. `POST /api/generate` resuelve el prompt de cada foto y hace el fan-out:
   N fotos → N jobs. Devuelve un `batchId` sin esperar al render.
4. El cliente sondea `GET /api/generate/[batchId]`. Cada llamada refresca los
   clips no terminados y reintenta los fallidos.
5. Cuando todos terminan, [`compose.ts`](src/lib/compose.ts) construye el
   *reel* y [`ReelPlayer`](src/components/ReelPlayer.tsx) lo reproduce
   encadenando los clips, ya visible al instante.
6. En paralelo, [`stitch`](src/lib/stitch) codifica en segundo plano el **MP4
   descargable** — el fichero que el cliente manda por WhatsApp o sube a un
   portal. Aparece un botón de descarga cuando está listo. Si no hay ffmpeg en
   el host, el recorrido sigue siendo reproducible y solo falta el fichero.
7. Si quedaron clips fallidos, `POST /api/generate/[batchId]` reintenta **solo
   esos**, sin volver a pagar los que ya salieron.

## Estados de un lote

| Estado | Significado |
| --- | --- |
| `processing` | Queda al menos un clip en cola, generando o esperando reintento. |
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
    api/styles/route.ts             # catálogo público (sin los prompts)
  components/
    PhotoDropzone.tsx               # drag & drop, reordenar y tipo de escena
    PropertyPicker.tsx              # elección de tipo de inmueble
    StylePicker.tsx                 # elección de estilo
    ClipProgressList.tsx            # progreso por clip
    ReelPlayer.tsx                  # reproduce el montaje
  lib/
    prompts/
      styles.ts                     # catálogo de estilos
      properties.ts                 # catálogo de tipos de inmueble
      scenes.ts                     # catálogo de escenas
      index.ts                      # resolutor de los tres ejes → prompt
    engine/                         # el motor de generación
      index.ts                      # superficie pública
      pipeline.ts                   # orquestación: abanico, sondeo, reenvío
      transitions.ts                # decide el siguiente estado de un clip
      policy.ts                     # qué merece reintento y cuándo
      state.ts                      # estado del lote
      serialize.ts                  # qué puede devolver la API
    compose.ts                      # timeline del recorrido
    stitch/                         # el MP4 descargable
      index.ts                      # selección de backend
      ffmpeg.ts                     # codificación real
    providers/                      # backends de vídeo
      index.ts                      # selección de proveedor
      higgsfield.ts                 # proveedor real
      mock.ts                       # proveedor simulado
    storage/                        # dónde van las fotos
      index.ts                      # selección de driver
      local.ts                      # disco local
    jobStore/                       # dónde viven los lotes
      index.ts                      # selección de almacén
      memory.ts                     # en memoria (ver aviso abajo)
    concurrency.ts                  # map con concurrencia limitada
    config.ts                       # tunables por variable de entorno
  types/                            # tipos del dominio
```

Los tres puntos que atan la app a una máquina concreta — proveedor de vídeo,
almacenamiento de fotos y persistencia de lotes — están detrás de una interfaz
con el mismo patrón: un módulo por backend y un `index.ts` que elige según
variable de entorno. Cambiar de hosting es escribir un módulo, no reescribir.

## Tests

```bash
npm test
```

Cubren la lógica pura del backend: composición de prompts, integridad del
catálogo, política de reintentos, estado derivado del lote, montaje,
concurrencia, la proyección pública y el motor completo contra un proveedor de
prueba. No necesitan navegador, red ni credenciales.

Hay dos que conviene no borrar: uno comprueba que el prompt compuesto **nunca**
sale por la API, y otro que un fallo permanente no se reintenta.

El test de montaje sí ejecuta ffmpeg de verdad: junta tres clips que discrepan
en resolución, fotogramas y duración, que es lo que devuelve un modelo de vídeo
job a job. Se salta solo si el host no tiene ffmpeg.

## Configuración

Todo en [`src/lib/config.ts`](src/lib/config.ts), ajustable por entorno. Los
que importan:

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `VIDEO_PROVIDER` | auto | `mock` o `higgsfield`. Sin valor: higgsfield si hay API key, si no mock. |
| `STORAGE_DRIVER` | `local` | Dónde se guardan las fotos. |
| `BATCH_STORE` | `memory` | Dónde viven los lotes. |
| `MAX_PHOTOS_PER_BATCH` | 20 | Cada foto es un job: esto acota el gasto. |
| `CREATE_CONCURRENCY` | 4 | Jobs creados a la vez. Subirlo invita a un 429. |
| `POLL_CONCURRENCY` | 6 | Consultas de estado en paralelo. |
| `MAX_CLIP_ATTEMPTS` | 2 | Reintentos automáticos por clip. |
| `RETRY_BACKOFF_SECONDS` | 15 | Espera antes de reintentar, doblándose en cada intento. |
| `CLIP_TIMEOUT_MINUTES` | 10 | A partir de aquí se da por perdido un clip atascado. |
| `STITCH_DRIVER` | auto | `ffmpeg` o `none`. Sin valor: ffmpeg si está disponible. |
| `FFMPEG_PATH` | `ffmpeg` | Ruta al binario si no está en el PATH. |
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
- **El almacén de lotes es memoria de un proceso**: en serverless o con varias
  instancias, dos sondeos consecutivos pueden caer en procesos distintos y dar
  404. Implementa `BatchStore` sobre Redis/Postgres/KV y regístralo en
  `src/lib/jobStore/index.ts`.
- **El almacenamiento por defecto escribe en disco local** (`public/uploads`).
  En serverless implementa `StorageProvider` sobre S3, Cloudinary o Vercel Blob.
  Además el proveedor descarga las URLs él mismo, así que en producción tienen
  que ser públicas de verdad.
- **No hay autenticación**: cualquiera que llegue a la URL puede gastar tus
  créditos. Hace falta login y control de consumo antes de abrirlo.
- **El montaje corre en segundo plano dentro del proceso web.** Sobrevive en un
  servidor de larga vida, pero en serverless lo matan a mitad de la
  codificación: allí hace falta una cola y un worker. El hueco es
  [`src/lib/stitch`](src/lib/stitch).
- **El host necesita un ffmpeg con libx264.** Sin él se cae a VP8/WebM, que es
  peor entregable: WhatsApp y varios portales lo manejan mal. Sin ffmpeg
  ninguno, el usuario se queda con el recorrido reproducible pero sin fichero.
