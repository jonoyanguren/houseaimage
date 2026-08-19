---
name: video-provider
description: Cómo añadir, corregir o depurar un motor de vídeo en houseaimage — plugins de API REST, MCP y línea de comandos (Higgsfield, Runway, Kling, Luma, simulado…). Úsala al integrar un backend nuevo, al ajustar rutas o payloads porque devuelven 4xx o campos inesperados, al mapear estados del proveedor, cuando los clips salgan `failed` sin motivo claro, o al tocar el cliente MCP y la ejecución de comandos.
---

# Motores de vídeo

Todo lo específico de un backend vive en `src/lib/providers/`. El resto del
código no sabe cuál está en uso, y así debe seguir.

## Dos capas, no una

```
ProviderPlugin   qué se le pide al operador, y cómo construirlo   ← se elige en Ajustes
   └─ VideoProvider   crear un job y consultarlo                  ← lo usa el pipeline
```

`VideoProvider` ya existía y bastaba mientras todos los backends se alcanzaban
igual: HTTP con un bearer. Dejó de bastar cuando **el mismo proveedor pasó a ser
alcanzable de tres formas** — su API REST, su servidor MCP y un binario en el
host. Eso cambia el *transporte* y lo que hay que configurar, no lo que hace.

Un plugin es un `VideoProvider` más las dos cosas que la interfaz necesita para
ofrecerlo con honestidad: qué campos pedir y cómo se llega.

| Plugin | Transporte | Fichero |
| --- | --- | --- |
| `higgsfield-api` | REST + clave | `providers/higgsfield.ts` |
| `higgsfield-mcp` | MCP (HTTP o proceso local) | `providers/higgsfield-mcp.ts` |
| `cli` | Binario con contrato create/status | `providers/higgsfield-cli.ts` |

El registro es `providers/plugins.ts`. Añadir un backend es un módulo y una
línea ahí: **el panel de Ajustes se dibuja solo** a partir de `fields`, así que
no hay que tocar ningún componente.

El proveedor simulado **no** está en el registro a propósito: es la *ausencia*
de plugin, no una opción entre ellos.

## El contrato

```ts
interface VideoProvider {
  readonly name: string;
  createClipJob(input: CreateClipInput): Promise<ProviderClipJob>;
  getClipJobStatus(providerJobId: string): Promise<ProviderClipStatus>;
  verifyCredentials?(): Promise<ProviderVerification>;   // opcional
}
```

Reglas no negociables, valgan para el transporte que valgan:

- **Una imagen por job.** `CreateClipInput` lleva un solo `imageUrl`. Aunque un
  backend acepte varias, manda una: el montaje y el orden dependen de que un
  clip corresponda exactamente a una foto.
- **Los proveedores no escriben prompts.** Llega `resolved` ya compuesto por
  `src/lib/prompts`. No lo reescribas ni lo traduzcas.
- **Un estado desconocido es `processing`, nunca `failed`.** Usa
  `normalizeStatus` de `providers/status.ts` — está compartido justo para que
  esta regla no exista en dos copias que se separen.
- **Terminado sin vídeo es un fallo.** Un job `completed` sin URL es un contrato
  roto; devuélvelo como `failed` para que el clip siga siendo reintentable en
  vez de dejar un hueco silencioso en el recorrido.
- **Clasifica tus propios errores.** Solo el proveedor sabe qué significan sus
  códigos. `unauthorized` e `invalid_input` son permanentes y no se reintentan;
  el resto son transitorios.

## Las credenciales no salen de `process.env`

Llegan como `PluginConfig` desde `src/lib/settings`, que decide entre el entorno
y lo conectado en el panel:

```ts
create(config: PluginConfig): VideoProvider
```

**El entorno gana siempre.** Si `HIGGSFIELD_API_KEY` está puesta, el panel la
muestra bloqueada y se niega a cambiarla — de otro modo cualquiera que llegue a
Ajustes podría redirigir el gasto a su propia cuenta.

Y **el proveedor se construye por operación, no se cachea**: la configuración
puede cambiar entre un lote y el siguiente, y un closure viejo seguiría gastando
en la cuenta de hace una hora.

### Los secretos no vuelven al navegador

Un campo declarado `kind: "secret"` sale enmascarado (`····1234`). El panel
sabe que una máscara no es un valor y no la reenvía. Si añades un campo con algo
sensible, márcalo `secret` o lo estarás publicando.

## MCP

`src/lib/mcp/client.ts` es un cliente JSON-RPC mínimo — `initialize`,
`tools/list`, `tools/call` — con dos transportes: **http** (servidor alojado,
funciona en cualquier host) y **stdio** (proceso local).

La secuencia de Higgsfield la fija su propio contrato de herramientas:

```
media_import_url(url)  →  media_id        # generate_video rechaza URLs sueltas
generate_video({ model, prompt, medias:[{role:"start_image", value:media_id}] })  →  job id
job_status(jobId)  →  estado + url del vídeo
```

Dos cosas que muerden:

- **`media_import_url` exige HTTPS.** Las fotos tienen que ser públicas y con
  TLS; un `public/uploads` en localhost no sirve.
- **Las respuestas no tienen forma fija.** Las *entradas* sí (las pin el
  esquema del servidor), pero cada servidor anida su respuesta a su manera. Por
  eso `pick()` busca en profundidad `job_id`/`id`/`video_url`… en vez de leer
  una ruta concreta. Si añades un valor que leer, añádelo a esas listas de
  claves.

## Ejecutar comandos está desactivado por defecto

El plugin de CLI y el transporte stdio de MCP **lanzan procesos en el servidor
con lo que diga el panel de Ajustes**. Eso es ejecución de código arbitrario
para cualquiera que pase el código de acceso, así que se rechaza salvo que el
host ponga:

```bash
ENGINE_ALLOW_COMMANDS=1
```

**No quites esa comprobación para facilitar un despliegue.** Y todo va por
`execFile` sin shell: los argumentos se parten con `splitArgs`, que respeta
comillas y no emula nada más de un shell.

### El contrato del CLI

Deliberadamente no atado a un proveedor: los flags de cada uno cambian. Dos
verbos, JSON por stdin y por stdout:

```bash
<command> create        # stdin {imageUrl,prompt,negativePrompt,aspectRatio,durationSeconds}
                        # stdout {"id":"…","status":"queued"}
<command> status <id>   # stdout {"status":"completed","videoUrl":"…","progress":42}
```

Tolera que el binario escriba logs antes: se toma la última línea que sea JSON.
`src/lib/providers/cli.test.ts` contiene una implementación de referencia.

## Selección

Por orden: `VIDEO_PROVIDER` si está puesto → el plugin conectado (del entorno o
del panel) → `mock`. El último escalón es lo que permite clonar el repo y verlo
funcionar sin configurar nada; no lo quites.

Si te ves añadiendo un `if` por backend fuera de `providers/index.ts` o
`plugins.ts`, la abstracción se está filtrando.

## Cómo probarlo sin gastar créditos

- `mcp.test.ts` levanta un servidor MCP falso y recorre importar → generar →
  sondear, incluyendo respuestas por SSE y errores 401/429.
- `cli.test.ts` ejecuta un binario de verdad (Node) que cumple el contrato.
- El proveedor simulado cubre el pipeline entero: `MOCK_FAILURE_RATE=0.4 npm run dev`.

Ninguno necesita red ni credenciales. Si tocas un invariante de arriba, **hay un
test que debe fallar**.
