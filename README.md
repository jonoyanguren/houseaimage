# houseaimage

Boilerplate Next.js para subir fotos y generar un vídeo con [Higgsfield](https://higgsfield.ai).

## Flujo

1. El usuario arrastra/selecciona varias fotos ([`PhotoDropzone`](src/components/PhotoDropzone.tsx)), puede reordenarlas y quitarlas.
2. Al pulsar "Generar vídeo", el cliente ([`useVideoGeneration`](src/lib/useVideoGeneration.ts)):
   - Sube las fotos a `POST /api/upload`, que las guarda en `public/uploads` y devuelve URLs públicas.
   - Llama a `POST /api/generate` con esas URLs, que crea un job en Higgsfield.
   - Hace polling a `GET /api/generate/[jobId]` hasta que el job termina, y muestra el vídeo resultante.

## Configuración

```bash
cp .env.example .env.local
```

Rellena `HIGGSFIELD_API_KEY` con tu API key de Higgsfield.

```bash
npm install
npm run dev
```

## ⚠️ Antes de usar en producción

- **API de Higgsfield**: el cliente en [`src/lib/higgsfield.ts`](src/lib/higgsfield.ts) usa un endpoint y payload de ejemplo (`POST /videos/generate`, `GET /videos/generate/:id`). Confírmalos contra la documentación oficial de tu cuenta de Higgsfield (rutas, nombres de campos, presets válidos) y ajusta `createVideoJob` / `getVideoJobStatus`.
- **Almacenamiento de fotos**: [`src/lib/storage.ts`](src/lib/storage.ts) guarda las fotos en el filesystem local (`public/uploads`), lo cual solo funciona en un servidor con disco persistente. Para desplegar en plataformas serverless (Vercel, etc.) sustituye `saveImage` por un proveedor real (S3, Cloudinary, Vercel Blob) — la interfaz ya está aislada para que sea un cambio de un solo archivo.

## Estructura

```
src/
  app/
    page.tsx                     # UI principal
    api/upload/route.ts          # sube fotos, devuelve URLs
    api/generate/route.ts        # crea el job de vídeo en Higgsfield
    api/generate/[jobId]/route.ts # consulta el estado del job
  components/
    PhotoDropzone.tsx            # drag & drop + reordenar fotos
  lib/
    higgsfield.ts                # cliente de la API de Higgsfield
    storage.ts                   # guardado de fotos subidas
    useVideoGeneration.ts        # hook: sube, genera y hace polling
  types/
    higgsfield.ts                # tipos compartidos
```
