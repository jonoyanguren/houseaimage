---
name: video-provider
description: Cómo añadir, corregir o depurar un backend de vídeo en houseaimage (Higgsfield, Runway, Kling, Luma, simulado…). Úsala al integrar un proveedor nuevo, al ajustar rutas/payloads de la API de Higgsfield porque devuelve 4xx o campos inesperados, al mapear estados del proveedor, o cuando los clips salgan `failed` sin motivo claro. También si hay que cambiar de proveedor o soportar varios.
---

# Proveedores de vídeo

Todo lo específico de un backend vive en `src/lib/providers/`. El resto del
código no sabe cuál está en uso, y así debe seguir.

## El contrato

```ts
interface VideoProvider {
  readonly name: string;
  createClipJob(input: CreateClipInput): Promise<ProviderClipJob>;
  getClipJobStatus(providerJobId: string): Promise<ProviderClipStatus>;
}
```

Dos reglas no negociables:

- **Una imagen por job.** `CreateClipInput` lleva un solo `imageUrl`. Si un
  proveedor aceptase varias, sigue mandando una: el montaje y el orden dependen
  de que un clip corresponda exactamente a una foto.
- **Sin estado.** Todo lo necesario para retomar el sondeo tras un reinicio
  tiene que caber en `providerJobId`. Mira `providers/mock.ts`: codifica el
  instante de creación y la duración en el propio id, así que su estado es
  función pura del id y el reloj.

## Añadir un proveedor

1. Crea `src/lib/providers/<nombre>.ts` exportando un `VideoProvider`.
2. Regístralo en el mapa `PROVIDERS` de `providers/index.ts`.
3. Documenta sus variables en `.env.example`.

No hace falta tocar nada más. Si te ves editando `pipeline.ts` o la UI para
soportar un proveedor, la abstracción se está filtrando: corrígela ahí.

## Mapear estados

Usa `normalizeStatus` de `higgsfield.ts` como plantilla. Lo importante:

- Lista explícitamente los estados terminales (`completed`, `failed`) y los de
  cola.
- **Todo lo desconocido cae en `processing`.** Los proveedores añaden estados
  con el tiempo. Un clip marcado por error como fallido no se recupera nunca;
  uno marcado por error como en curso se corrige en el siguiente sondeo.
- Un job `completed` **sin URL de vídeo** es un incumplimiento del contrato:
  conviértelo en `failed` con un error explicativo, para que entre en la ruta
  de reintento en vez de dejar un hueco silencioso en el montaje.

## Errores

- Lanza excepciones desde el proveedor. `pipeline.ts` las captura y las
  convierte en un clip `failed`; no las tragues devolviendo un estado inventado.
- Pon timeout a toda llamada de red (`AbortSignal.timeout`). Sin él, un
  proveedor colgado bloquea un handler de ruta indefinidamente.
- Trunca el cuerpo del error del proveedor antes de propagarlo: acaba en la UI.

## Depurar la integración con Higgsfield

Las rutas y nombres de campo de `higgsfield.ts` son un placeholder razonable,
no doctrina. Si la API devuelve 4xx o campos que no esperas:

1. Contrasta con la referencia de tu cuenta (`https://docs.higgsfield.ai` o el
   panel). Ajusta las dos llamadas `fetch` y ya.
2. Comprueba que las URLs de imagen son **públicas**. El proveedor las descarga
   él; una URL de `localhost` falla en cuanto sales de dev.
3. Aísla el problema volviendo al simulado, que descarta que el fallo esté en
   el pipeline:

```bash
VIDEO_PROVIDER=mock npm run dev
```

`VIDEO_PROVIDER` gana siempre sobre la detección automática, así que puedes
forzar el simulado teniendo una API key válida.

## Selección de proveedor

Por orden: `VIDEO_PROVIDER` si está puesto → `higgsfield` si hay
`HIGGSFIELD_API_KEY` → `mock`. El último escalón es lo que permite clonar el
repo y verlo funcionar sin configurar nada; no lo quites.
