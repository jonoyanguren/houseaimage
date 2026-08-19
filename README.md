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

Y ya está: sin configurar nada corre con el **proveedor simulado** y puedes
recorrer la aplicación entera sin gastar un céntimo. Para llegar a un vídeo de
verdad, sigue la guía de aquí abajo.

## De cero a un vídeo real

Los pasos, en orden. **El orden importa**: hay dos sitios donde hacerlo al revés
cuesta rehacerlo.

### 0 · Sin configurar nada

```bash
npm install
npm run dev
```

Arrastra fotos y genera. Verás el recorrido completo —abanico, progreso por
clip, montaje— con el **proveedor simulado**: cada plano es la fotografía con un
paneo lento y la etiqueta «Vista previa simulada». No se renderiza nada y no se
gasta nada. Sirve para conocer la herramienta antes de conectarla.

### 1 · Que un modelo mire las fotos *(opcional, recomendado)*

Sin esto, la estancia de cada foto se deduce del nombre del fichero, y con
`IMG_2481.jpg` no se deduce nada. Con esto se clasifican todas y además avisa de
los planos de planta y las fotos inservibles, **antes** de pagarlas.

```bash
ollama pull qwen2.5vl:7b
```

**Ajustes → Clasificación de fotos → Modelo local (Ollama) → Buscar modelos →
elígelo → Guardar.** Al guardar se precalienta el modelo, así que la primera
foto ya no espera a que cargue.

### 2 · Publicar la aplicación, o abrir un túnel

**Este paso va antes de conectar el motor, no después.** El proveedor de vídeo
descarga las fotos él mismo por HTTPS público: desde `localhost` fallan *todos*
los clips.

```bash
cloudflared tunnel --url http://localhost:3000
```

Y arranca el servidor con la URL que te dé:

```bash
APP_URL=https://tu-tunel.example npm run dev
```

### 3 · Conectar el motor de vídeo

**Ajustes → Motor de vídeo.** Tres formas, y ninguna necesita que edites
ficheros:

- **Higgsfield · API** — pega una clave de tu cuenta y listo.
- **Higgsfield · MCP** — guarda la URL de su servidor MCP y pulsa **«Autorizar
  en Higgsfield»**. No hay clave: entras con tu cuenta en el navegador y
  vuelves. La sesión se renueva sola.
- **Línea de comandos** — un binario tuyo que cumpla el contrato
  `create`/`status`. Requiere `ENGINE_ALLOW_COMMANDS=1`.

⚠️ **Autoriza después de fijar `APP_URL`.** La URL de retorno se deriva de ella,
y cambiarla obliga a registrar el cliente otra vez.

### 4 · Poder entregar el fichero

Sin ffmpeg el recorrido se reproduce pero no hay MP4 que descargar, que es lo
que el cliente se lleva.

```bash
# Windows
winget install Gyan.FFmpeg
# macOS
brew install ffmpeg
# Debian/Ubuntu
sudo apt install ffmpeg
```

Cierra y reabre la terminal después, para que coja el PATH.

### 5 · Cerrar la puerta antes de publicarla

Cada vídeo consume créditos, así que una URL abierta es una cartera abierta.

```bash
APP_ACCESS_CODE=... npm run dev
```

### 6 · Poner tu marca *(opcional)*

**Ajustes → Marca de la agencia**: nombre, contacto y logotipo, y activa el
cartón final y la marca de agua. Es lo que convierte un montaje bonito en una
pieza que una inmobiliaria publica.

## La barra de estado es la lista de comprobación

No hace falta que recuerdes nada de lo anterior: la aplicación lo dice siempre,
debajo de la cabecera.

```
MOTOR simulado · FOTOS locales · ENTREGA sin fichero · ACCESO abierto
```

| Lectura | En latón significa | Se arregla en |
| --- | --- | --- |
| `MOTOR` | No se renderiza nada de verdad | Paso 3 |
| `FOTOS` | El motor no podrá descargarlas y fallarán todos los clips | Paso 2 |
| `ENTREGA` | No habrá fichero descargable | Paso 4 |
| `ACCESO` | Cualquiera con la URL puede gastar tus créditos | Paso 5 |

**Todo en gris = listo para renderizar de verdad.** Cuando lo esté, empieza con
dos o tres fotos: la primera tanda real es para comprobar el circuito, no para
hacer un vídeo.

### Si algo falla

El error de cada plano sale junto a su miniatura, y son accionables a
propósito. El más común, con diferencia:

> Higgsfield descarga las fotos él mismo y solo acepta HTTPS público…

es el paso 2 sin hacer.

⚠️ **Al reiniciar el servidor se pierden la autorización de Higgsfield y los
lotes en curso**: viven en memoria. Es la misma limitación que la persistencia
pendiente — ver los avisos de producción al final.

## Motores de vídeo

El mismo proveedor es alcanzable de tres formas, y eso cambia el **transporte**,
no lo que hace. Así que un motor es un *plugin*: un backend más los campos que
la interfaz tiene que pedir.

| Plugin | Cómo | Para |
| --- | --- | --- |
| **Higgsfield · API** | REST con una clave | La vía directa. Funciona en cualquier host. |
| **Higgsfield · MCP** | Servidor MCP, remoto o local | Sin clave: entras con tu cuenta en el navegador, una vez. |
| **Línea de comandos** | Cualquier binario con contrato `create`/`status` | Envolver el CLI de un proveedor, o un script propio. |
| *(ninguno)* | Simulado | Por defecto. No renderiza ni gasta. |

El panel de Ajustes se dibuja solo a partir de los campos que declara cada
plugin, así que añadir un motor es un módulo y una línea en
[`providers/plugins.ts`](src/lib/providers/plugins.ts) — ningún componente
cambia.

Todo lo que escribas ahí se guarda en el servidor y **nada sensible vuelve al
navegador**: un campo declarado secreto sale enmascarado (`····1234`), y el
panel sabe que una máscara no es un valor y no la reenvía.

Se pierde al reiniciar. Para que persista, ponlo en el entorno
(`cp .env.example .env.local`) — y ten en cuenta que **una clave en el entorno
manda sobre el panel**, que la muestra bloqueada. Si no fuera así, cualquiera
que llegase a Ajustes podría desviar el gasto a otra cuenta.

**MCP** ([`lib/mcp/client.ts`](src/lib/mcp/client.ts)) es un cliente JSON-RPC
mínimo, sin dependencias. La secuencia la fija el propio servidor: importar la
foto (`media_import_url`), lanzar el trabajo (`generate_video`) y sondearlo
(`job_status`). Ojo: la importación exige **HTTPS**, así que las fotos tienen
que ser públicas de verdad.

### Elegir modelo, y saber lo que cuesta antes de gastarlo

El catálogo **se pide al motor**, no está escrito aquí: los modelos se añaden,
se renombran y se retiran, y una lista a mano se convierte en mentira con
fecha. En **Ajustes → Motor de vídeo → Ver modelos** aparecen con su fabricante
y las duraciones que aceptan, y al lado los créditos que te quedan.

Solo se ofrecen los que aceptan **una foto como primer fotograma**. El mismo
catálogo trae modelos que convierten un vídeo de YouTube en clips o que montan
anuncios de producto: son modelos de vídeo, y no saben hacer lo que hace esta
aplicación. Ofrecerlos sería una trampa.

El **coste sale en el raíl**, justo encima del botón que lo gasta:

```
Coste estimado                    75 créditos
7,5 créditos por plano · lo cotiza el proveedor, no lo calculamos aquí
```

Se pregunta al motor con `get_cost`, que cotiza sin enviar ningún trabajo. Solo
él sabe lo que hacen una resolución, un segundo más o una pista de audio al
precio. Si un backend no sabe contestar, el raíl no dice nada: **una cifra
ausente es mejor que una inventada**.

Y si el modelo elegido no admite la duración que fija el estilo —un reel de
dron pide 8 s y hay modelos que solo hacen 5 o 10— se redondea al valor más
cercano **y se avisa**, porque quedarse callado es como alguien acaba con
planos de diez segundos que ni pidió ni presupuestó.

### El MCP de Higgsfield no se conecta con una clave

Responde `401` con `WWW-Authenticate: Bearer`, así que **no hay ningún token que
pegar**: se autoriza en el navegador, una vez. En Ajustes guardas la URL y
pulsas «Autorizar en Higgsfield».

Lo que hace [`lib/mcp/oauth.ts`](src/lib/mcp/oauth.ts) por debajo, todo estándar
y sin nada codificado a mano para Higgsfield:

1. **Descubre** los endpoints desde la URL del MCP.
2. **Se registra solo** como cliente OAuth (registro dinámico), así que nadie
   tiene que dar de alta un `client_id` a mano.
3. **PKCE** — cliente público, sin secreto que custodiar. El verificador no sale
   nunca del servidor; por el navegador solo viaja su hash.
4. **`offline_access`** — un token de refresco, que es lo que permite que la
   plataforma siga renderizando de madrugada sin nadie delante. Se renueva sola,
   y también ante un `401` inesperado.

Se puede probar **desde `localhost`**: la redirección la hace tu navegador, no
el servidor de Higgsfield. Detrás de un túnel o en producción, pon `APP_URL`
para que la URL de retorno sea la pública.

⚠️ La autorización vive **en memoria**, como los lotes: al reiniciar hay que
volver a pulsar el botón. Que sobreviva exige cifrar el token de refresco en
reposo, y esa decisión va con la de añadir base de datos.

**Línea de comandos** es un puente genérico, no el CLI de nadie en concreto —
los flags de cada proveedor cambian y atarse a unos sería una apuesta con fecha
de caducidad:

```bash
<command> create        # stdin  {imageUrl,prompt,negativePrompt,aspectRatio,durationSeconds}
                        # stdout {"id":"…","status":"queued"}
<command> status <id>   # stdout {"status":"completed","videoUrl":"…"}
```

⚠️ El plugin de CLI y el MCP local **lanzan procesos en el servidor** con lo que
diga el panel. Para cualquiera que pase el código de acceso eso es ejecución de
código arbitrario, así que están desactivados salvo que pongas
`ENGINE_ALLOW_COMMANDS=1`.

## Acceso

Cada vídeo consume créditos, así que una URL abierta es una cartera abierta:

```bash
APP_ACCESS_CODE=loquesea npm run dev
```

Con eso, todo queda detrás de un código y una cookie firmada. Sin eso la app
está abierta a quien llegue, y el panel de Ajustes lo dice en rojo.

`/uploads` queda deliberadamente fuera del cerrojo: el proveedor de vídeo
descarga esas fotos él mismo y no tiene ninguna cookie que presentar.

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

## Quién decide qué muestra cada foto

La escena es el eje que fija el movimiento de cámara, así que acertarla importa
tanto como el estilo. Hay dos formas de decidirla, en
[`src/lib/vision`](src/lib/vision):

| Driver | Cómo | Qué consigue |
| --- | --- | --- |
| `heuristic` *(por defecto)* | Nombre de fichero, y posición si el nombre no dice nada | Acierta con `salon-2.jpg`, se rinde con `IMG_2481.jpg` |
| `ollama` | Un modelo local **mira** la fotografía | Clasifica todas, y avisa de lo que no conviene animar |

Lo segundo es lo que enciende el catálogo de escenas entero, y además detecta
lo que hay que descartar **antes** de pagarlo: el plano de planta que toda
inmobiliaria mete en el anuncio, la foto borrosa, la repetida. Un render
evitado paga un año de clasificación.

En **Ajustes → Clasificación de fotos** eliges el modelo de una lista de los que
tienes instalados, con los que no ven imágenes deshabilitados.

```bash
ollama pull qwen2.5vl:7b     # verificado: detecta planos de planta y fotos inservibles
```

⚠️ **Que un modelo declare `vision` no garantiza que la use.** Nos pasó con uno
que anunciaba la capacidad y respondía «Black» tanto a una imagen roja como a
una azul: contestaba sin mirar. La prueba que lo caza en diez segundos es
mandarle un color plano y preguntarle cuál es. Si tarda uno o dos segundos y
acierta, ve; si contesta al instante y siempre lo mismo, no.

Tres decisiones que no son negociables:

- **Nunca se descarta una foto sola.** El aviso sale junto a la miniatura y
  decide la persona. Acertar mucho no es acertar siempre.
- **Si el modelo duda, gana el nombre del fichero.** Una abstención no es mejor
  información que un nombre que sí dice algo.
- **Si el modelo se cae, tarda o desvaría, se cae a la heurística.** Un
  clasificador nunca puede tumbar una subida.

Con un modelo local, **las fotos no salen de tu máquina** — que en interiores de
viviendas habitadas es un argumento de venta, no un detalle técnico.

## Qué pasa por dentro

1. El usuario arrastra las fotos ([`PhotoDropzone`](src/components/PhotoDropzone.tsx)),
   las ordena arrastrándolas y corrige qué es cada una. **Ese orden es el del
   vídeo final.** Cada foto se preclasifica por su nombre de fichero
   (`salon-2.jpg`, `master-bedroom.jpg`), y por posición cuando el nombre no
   dice nada — ver [`prompts/classify.ts`](src/lib/prompts/classify.ts).
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
8. Un plano que salió bien pero no convence se re-renderiza suelto con
   `POST /api/generate/[batchId]/clips/[clipId]`. Cuesta un trabajo, no un
   lote, y descarta el MP4 montado porque el metraje ha cambiado.

## La marca de la agencia

En **Ajustes → Marca** se guardan nombre, contacto y logotipo, y se activan dos
cosas que se estampan en el fichero descargable:

- **Cartón final** — cierra el vídeo con el nombre y el teléfono. Es la
  diferencia entre un clip bonito y una pieza de marketing: sin él, el vídeo
  acaba en una habitación y nadie sabe a quién llamar. Se dibuja con `next/og`
  y no con `drawtext`, que necesita adivinar una ruta de fuente por host y
  destroza los acentos cuando acierta con la equivocada.
- **Marca de agua** — el logotipo, discreto, en una esquina.

Nada de esto puede tumbar un montaje: si el logotipo no se descarga o el cartón
no se dibuja, se pierde la marca y no el vídeo, que el cliente ya ha pagado.

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
    page.tsx                        # entrada de servidor: resuelve ajustes
    entrar/page.tsx                 # la puerta, cuando hay código de acceso
    opengraph-image.tsx             # tarjeta del enlace al compartirlo
    api/settings/                   # conexión del proveedor y marca
    api/auth/route.ts               # entrar y salir
    api/upload/route.ts             # sube fotos → URLs
    api/generate/route.ts           # POST: fan-out del lote
    api/generate/[batchId]/route.ts # GET: estado · POST: reintentar fallidos
    api/styles/route.ts             # catálogo público (sin los prompts)
  components/
    AppShell.tsx                    # cabecera, estado del motor y ajustes
    Studio.tsx                      # el espacio de trabajo
    SettingsPanel.tsx               # conectar Higgsfield · marca · acceso
    StylePreview.tsx                # esquema animado del movimiento
    ShotList.tsx                    # regenerar o descargar un plano
    PhotoDropzone.tsx               # drag & drop, reordenar y tipo de escena
    PropertyPicker.tsx              # elección de tipo de inmueble
    StylePicker.tsx                 # elección de estilo
    ClipProgressList.tsx            # progreso por clip
    ReelPlayer.tsx                  # reproduce el montaje
  lib/
    settings/                       # ajustes en caliente (clave, marca)
    auth/session.ts                 # código de acceso y cookie firmada
    ratelimit.ts                    # límite por IP en lo que cuesta dinero
    prompts/
      classify.ts                   # qué muestra cada foto
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
      endcard.tsx                   # el cartón final, dibujado como PNG
    mcp/client.ts                   # cliente MCP mínimo (http y stdio)
    providers/                      # motores de vídeo
      index.ts                      # selección de motor
      plugins.ts                    # el registro de plugins
      higgsfield.ts                 # plugin de API REST
      higgsfield-mcp.ts             # plugin de MCP
      higgsfield-cli.ts             # plugin de línea de comandos
      status.ts                     # vocabulario de estados compartido
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
| `VIDEO_PROVIDER` | auto | `mock`, `higgsfield-api`, `higgsfield-mcp` o `cli`. Sin valor: el plugin conectado, y si no hay ninguno, mock. |
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
| `APP_ACCESS_CODE` | — | Sin él, la app está abierta a quien llegue a la URL. |
| `APP_SESSION_SECRET` | el código | Firma la cookie. Cambiarlo cierra todas las sesiones. |
| `APP_URL` | `http://localhost:3000` | URL pública. La usan la tarjeta del enlace y el montaje al descargar el logotipo. |
| `ENGINE_ALLOW_COMMANDS` | — | Permite lanzar procesos (plugin CLI y MCP local). Desactivado por defecto. |

Para ver el camino de fallo:

```bash
MOCK_FAILURE_RATE=0.4 npm run dev
```

## ⚠️ Antes de producción

- **Endpoints de Higgsfield**: las rutas y nombres de campo en
  [`providers/higgsfield.ts`](src/lib/providers/higgsfield.ts) son un
  placeholder razonable. Confírmalos contra la documentación de tu cuenta.
  Todo lo demás es agnóstico del proveedor, así que corregirlos es un cambio de
  un solo archivo. La vía MCP no tiene ese problema: allí las entradas las fija
  el esquema del propio servidor.
- **El almacén de lotes es memoria de un proceso**: en serverless o con varias
  instancias, dos sondeos consecutivos pueden caer en procesos distintos y dar
  404. Implementa `BatchStore` sobre Redis/Postgres/KV y regístralo en
  `src/lib/jobStore/index.ts`.
- **El almacenamiento por defecto escribe en disco local** (`public/uploads`).
  En serverless implementa `StorageProvider` sobre S3, Cloudinary o Vercel Blob.
  Además el proveedor descarga las URLs él mismo, así que en producción tienen
  que ser públicas de verdad.
- **El acceso es un código compartido, no usuarios.** `APP_ACCESS_CODE` cierra
  la puerta y `src/lib/ratelimit.ts` acota el gasto por IP, que es suficiente
  para una agencia y no para vender por suscripción: no hay cuentas, ni
  consumo por cliente, ni facturación. La costura es
  [`src/lib/auth/session.ts`](src/lib/auth/session.ts).
- **La clave conectada desde el panel vive en memoria** y se pierde al
  reiniciar. Persistirla exige cifrarla en reposo contra un almacén de
  secretos de verdad, que es la misma decisión que la de la base de datos.
- **El montaje corre en segundo plano dentro del proceso web.** Sobrevive en un
  servidor de larga vida, pero en serverless lo matan a mitad de la
  codificación: allí hace falta una cola y un worker. El hueco es
  [`src/lib/stitch`](src/lib/stitch).
- **El host necesita un ffmpeg con libx264.** Sin él se cae a VP8/WebM, que es
  peor entregable: WhatsApp y varios portales lo manejan mal. Sin ffmpeg
  ninguno, el usuario se queda con el recorrido reproducible pero sin fichero.
