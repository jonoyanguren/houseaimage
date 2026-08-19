---
name: video-pipeline
description: Arquitectura de generación de vídeo de houseaimage — fan-out de un job por foto, polling por clip, reintentos y montaje. Úsala SIEMPRE antes de tocar src/lib/engine/, compose.ts, jobStore/, providers/ o las rutas /api/generate, y cuando haya que depurar clips atascados, lotes en `partial`, orden incorrecto en el vídeo final o errores 404 al sondear un lote. También al añadir estados, reintentos o pasos nuevos al pipeline.
---

# El pipeline de generación

## La restricción que lo explica todo

Los modelos image-to-video toman **un fotograma inicial** y devuelven **un clip
de 3-15 segundos**. No aceptan N fotos ni producen un vídeo largo.

De ahí sale la única arquitectura que puede funcionar:

```
N fotos → N jobs (fan-out) → N clips (polling independiente) → 1 montaje
```

Si alguna vez te ves escribiendo "mandar todas las fotos en un job", para: eso
es la arquitectura que este código sustituyó, y no puede funcionar.

El prompt de cada clip no se escribe aquí: lo compone `src/lib/prompts` a
partir del estilo y del tipo de escena (ver skill `video-styles`). El pipeline
lo resuelve una vez en `submitClip` y se lo pasa ya hecho al proveedor.

## Invariantes

Rómpelos y el vídeo sale mal aunque los tests pasen.

1. **`clip.index` es la posición en el vídeo final.** Se asigna en el fan-out a
   partir del orden que eligió el usuario y **no cambia nunca** — ni al
   reintentar, ni al reordenar resultados. Los proveedores terminan los jobs en
   orden arbitrario; `index` es lo único que preserva la intención del usuario.
   `composeReel` ordena por `index`, nunca por orden de llegada.

2. **`clipId` sobrevive a los reintentos.** Al re-enviar un clip se conserva su
   `clipId` y solo cambia `providerJobId`. Si generas un `clipId` nuevo, la UI
   remonta el elemento y el usuario ve un parpadeo.

3. **Un fallo aislado no tumba el lote.** `submitClip` captura los errores del
   proveedor y devuelve un clip `failed`; nunca propaga. Diez fotos con una
   mala tienen que dar nueve clips, no cero.

4. **Un estado desconocido del proveedor es `processing`, no `failed`.** Ver
   `normalizeStatus` en `providers/higgsfield.ts`. Un clip marcado
   erróneamente como fallido no se recupera jamás; uno marcado erróneamente
   como en curso se corrige solo en el siguiente sondeo.

5. **Nunca lances en paralelo sin límite.** Usa `mapWithConcurrency`. Un
   `Promise.all` sobre 20 fotos es la forma más rápida de comerse un 429, que
   además falla el lote entero en vez de solo ralentizarlo.

## Cómo está partido el motor

`src/lib/engine/` está dividido por responsabilidad, y la división es la que
evita la clase de bug que ya nos mordió dos veces: **el juicio vive en
funciones puras y la orquestación solo las ejecuta.**

| Módulo | Responsabilidad |
| --- | --- |
| `pipeline.ts` | Orquestación y E/S: abanico, sondeo, reenvío. Nada de criterio. |
| `transitions.ts` | El único sitio que decide el siguiente estado de un clip. Puro. |
| `policy.ts` | Las reglas que cuestan dinero: qué merece reintento y cuándo. Puro. |
| `state.ts` | Estado del lote derivado de sus clips. |
| `serialize.ts` | Proyección sobre lo que la API puede devolver. |

Importa siempre desde `@/lib/engine`, no de los módulos internos.

**Si añades una regla de decisión, va en `policy` o `transitions`, nunca en
`pipeline`.** Ese es el criterio: si necesitas un proveedor, un almacén o un
reloj para probarla, la has puesto en el sitio equivocado.

| Quiero… | Archivo |
| --- | --- |
| Cambiar cómo se crean o sondean los jobs | `src/lib/engine/pipeline.ts` |
| Regenerar un plano suelto | `regenerateClip` en `src/lib/engine/pipeline.ts` |
| Cambiar la marca estampada en el vídeo | `src/lib/stitch/` (usa `src/lib/settings`) |
| Cambiar cuándo se reintenta o se agota un clip | `src/lib/engine/policy.ts` |
| Cambiar cómo se monta el vídeo | `src/lib/compose.ts` |
| Cambiar el estado del lote | `src/lib/engine/state.ts` |
| Cambiar qué devuelve la API | `src/lib/engine/serialize.ts` |
| Persistir los lotes de verdad | `src/lib/jobStore/` |
| Cambiar dónde se guardan las fotos | `src/lib/storage/` |
| Añadir o corregir un backend | `src/lib/providers/` (ver skill `video-provider`) |
| Tocar estilos, escenas o prompts | `src/lib/prompts/` (ver skill `video-styles`) |
| Ajustar límites y concurrencia | `src/lib/config.ts` |

## No todos los fallos merecen reintento

Un fallo lleva un `FailureKind`, y el proveedor es quien lo clasifica porque es
el único que sabe qué significan sus códigos.

- `invalid_input` y `unauthorized` son **permanentes**: no se reintentan nunca.
  Reenviar una foto que el proveedor rechazó por formato cuesta exactamente lo
  mismo que un reintento que sí podría funcionar, y no puede producir nada.
- El resto son transitorios. `rate_limited` además espera bastante más, porque
  volver a los quince segundos choca con el mismo muro.
- Lo desconocido se trata como transitorio: rendirse con un clip recuperable
  cuesta más que un reintento desperdiciado.

Un fallo al **consultar** el estado no es un render fallido: es casi seguro un
problema de red con el job todavía vivo, así que se anota y no gasta intento.

## Lo interno no es lo que sale por HTTP

`toPublicBatch` proyecta el lote sobre lo que la API puede devolver. Retiene
`resolved` (el prompt compuesto), `providerJobId` y el objeto `failure`.

**Si añades un campo al motor, no llega solo al cliente — y es a propósito.**
Antes de que existiera esta proyección el modelo interno *era* la respuesta, y
por eso el prompt no se podía ni guardar. Hay un test que falla si el prompt
vuelve a salir.

## Estados del lote

`deriveBatchStatus` es la única fuente de verdad. No calcules el estado a mano
en otro sitio.

- `processing` — queda algún clip sin terminar.
- `completed` — todos bien.
- `partial` — todos terminaron, algunos fallaron. **Sigue habiendo montaje**
  con los supervivientes: esto es deliberado, no lo "arregles" convirtiéndolo
  en `failed`.
- `failed` — ninguno sirve.

## Qué cuenta como terminal

`isSettled` **no** es "completed o failed". Un clip fallido que todavía va a
reintentarse no está asentado — y si el fallo es permanente, sí lo está aunque
le queden intentos. Vive en `engine/policy.ts`.

Tratarlo como terminal provocaba que un lote se declarara muerto con un
reintento pendiente: si el proveedor rechazaba todas las fotos de golpe (rate
limit, caída breve), `POST /api/generate` devolvía `failed` y cualquier cliente
que se fiara de ese estado abandonaba trabajo que iba a recuperarse solo. Si
tocas esta función, hay tests que deben fallar.

## Acceso concurrente: relee dentro del cerrojo

`refreshBatch` y `retryFailedClips` reciben un **`batchId`, no un lote**, y lo
releen dentro de `withLock`. No es un capricho: recibir una instantánea
obtenida antes hacía que dos sondeos simultáneos vieran el mismo clip fallido y
lo reenviaran los dos — el cliente pagaba dos veces la misma foto.

Si añades otra operación que modifique un lote, mete la lectura dentro del
mismo cerrojo. Y recuerda que `src/lib/lock.ts` es de un solo proceso: quien
implemente un `BatchStore` distribuido tiene que implementar también un cerrojo
distribuido, o el doble cobro vuelve.

## Regenerar un plano no es reintentarlo

`regenerateClip(batchId, clipId)` re-renderiza **un** clip, esté como esté —
incluido uno que salió bien. No es recuperación de un error: es el usuario
diciendo que ese plano no le vale, y cuesta un trabajo del proveedor.

Va por el mismo cerrojo que el sondeo, conserva `clipId` e `index`, y reinicia
`attempts` a 1. No hay que invalidar el MP4 montado a mano: `withDerivedState`
compara el metraje y tira el fichero obsoleto solo.

## Reintentos: hay dos, y son distintos

- **Automático**, dentro de `refreshBatch`: un clip `failed` con
  `attempts < MAX_CLIP_ATTEMPTS` se re-envía, sin que el usuario haga nada,
  **una vez pasada la espera** (`RETRY_BACKOFF_SECONDS`, que se dobla en cada
  intento). Reintentar al instante vuelve a chocar con el rate limit que
  probablemente causó el fallo y gasta el intento restante para nada.
  Un clip que el proveedor no termina en `CLIP_TIMEOUT_MINUTES` se marca
  fallido con ese motivo y entra por esta misma vía.
- **Manual**, vía `POST /api/generate/[batchId]` → `retryFailedClips`: reinicia
  el contador y re-envía los que quedaron fallidos. Solo re-renderiza esos, así
  que rescatar un `partial` no vuelve a cobrar los clips que ya salieron.

## Los tres puntos conectables

Proveedor de vídeo, almacenamiento de fotos y persistencia de lotes siguen el
**mismo patrón**: una interfaz en `src/types`, un módulo por backend, y un
`index.ts` que elige según variable de entorno con reserva a la opción que
funciona sin configurar nada.

| Qué | Interfaz | Variable | Por defecto |
| --- | --- | --- | --- |
| Backend de vídeo | `VideoProvider` | `VIDEO_PROVIDER` | `mock` |
| Fotos | `StorageProvider` | `STORAGE_DRIVER` | `local` |
| Lotes | `BatchStore` | `BATCH_STORE` | `memory` |

Si te ves añadiendo un `if` por backend fuera de esos `index.ts`, la
abstracción se está filtrando.

**`BatchStore` es asíncrono a propósito**, aunque la implementación en memoria
no lo necesite: Redis, Postgres y KV lo son. Comprometerse con async ahora
evita que cambiar de backend rompa a todos los llamantes. No lo "simplifiques"
a síncrono.

## Tests

```bash
npm test          # una pasada
npm run test:watch
```

Cubren la lógica pura: prompts, integridad del catálogo, estado derivado,
montaje, concurrencia y el pipeline entero contra un proveedor de prueba
(`vi.mock` sobre `@/lib/providers`). Sin navegador, red ni credenciales.

Si tocas un invariante de los de arriba, **hay un test que debe fallar**. Si
cambias el comportamiento y no falla nada, falta cobertura: añádela antes de
seguir.

## Cómo probarlo sin gastar créditos

El proveedor simulado cubre el pipeline entero:

```bash
npm run dev                          # todo sale bien
MOCK_FAILURE_RATE=0.4 npm run dev    # ejercita partial + reintentos
MOCK_FAILURE_RATE=0.5 MAX_CLIP_ATTEMPTS=1 npm run dev   # fuerza partial estable
```

Y de punta a punta por API:

```bash
BID=$(curl -s -X POST localhost:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"photos":[{"imageUrl":"http://localhost:3000/uploads/a.jpg","sceneType":"salon"},
                 {"imageUrl":"http://localhost:3000/uploads/b.jpg","sceneType":"cocina"}],
       "options":{"styleId":"cinematografico"}}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).batchId')

curl -s localhost:3000/api/generate/$BID   # sondear
curl -s -X POST localhost:3000/api/generate/$BID   # reintentar fallidos
```

## Trampas conocidas

- **404 al sondear un lote que sí existe**: `jobStore` es memoria de un
  proceso. Pasa al recargar en dev con cambios en el módulo, y pasará siempre
  en serverless. No es un bug del polling.
- **Clips simulados sin `videoUrl`**: es por diseño. `isUsable` los acepta
  porque ocupan su hueco en el montaje; la UI muestra la foto con la etiqueta
  "Simulado". No los trates como incompletos.
- **URLs de `localhost` en producción**: el proveedor descarga las imágenes él
  mismo. En dev funciona solo porque el proveedor simulado no descarga nada.
