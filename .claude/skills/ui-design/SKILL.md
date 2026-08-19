---
name: ui-design
description: Sistema de diseño de houseaimage — tokens de color, escala tipográfica, densidad y movimiento del registro «instrumento de precisión». Úsala SIEMPRE antes de añadir o modificar pantallas, componentes o estilos en src/app y src/components, al tocar globals.css, y cuando algo desentone, se vea genérico, falle en modo claro u oscuro, o haya que elegir colores, tamaños de texto o animaciones.
---

# Sistema de diseño

El registro es **instrumento de precisión, en negro**: una sala de edición o una
mesa de color, no un catálogo impreso ni un panel de SaaS. El lujo viene de la
precisión y del **contraste** — líneas de un píxel, cifras que no se mueven, y
un salto brutal entre los dos extremos de la escala tipográfica. El latón es lo
único que tiene permiso para ser bonito.

Si un componente nuevo parece un dashboard genérico o un folleto, está mal.

## El oscuro no es una preferencia, es el producto

El fondo es **negro real** (`#000`). La fotografía vive sobre superficies
elevadas, no sobre el lienzo, y contra negro esas superficies se leen como
paneles iluminados y el latón gana un paso de intensidad.

**El tema no sigue al sistema operativo.** Antes sí, y eso significaba servir la
versión marfil a cualquiera que tuviera Windows en claro — la versión más floja
de este diseño, entregada por defecto y sin que nadie la eligiera. Ahora:

- Oscuro es `:root`, sin atributo y sin media query.
- Claro es **opt-in**: `:root[data-theme="light"]`, desde el control de la
  cabecera, y se guarda en `localStorage`.
- Un script en línea en el layout lo aplica **antes del primer pintado**. Si
  añades algo que dependa del tema, no lo sincronices con `useEffect`: eso es
  justo el parpadeo que ese script evita.

Sigue siendo un tema completo — todos los tokens redefinidos, ninguno prestado
del otro — porque los dos son pares aunque solo uno sea el de por defecto.

## Nunca uses un color literal

Todo el color sale de tokens definidos en `globals.css` y expuestos como
utilidades Tailwind. Un `bg-zinc-900` o un `#fff` en un componente es un bug:
rompe el modo claro, que no es un extra sino un tema de primera.

| Token | Uso |
| --- | --- |
| `canvas` | Fondo de página. Negro. |
| `surface` / `surface-raised` | Tarjetas y zonas elevadas. |
| `surface-sunken` | **Inputs y pozos.** Lo que el ojo debe leer como hundido. |
| `line-faint` / `line` / `line-strong` | Separadores internos, bordes, hover o activo. |
| `ink` / `muted` / `faint` | Texto principal, secundario, terciario. |
| `accent` / `accent-ink` / `accent-soft` / `accent-line` | Latón, texto sobre latón, fondo tenue, borde de lo seleccionado. |
| `positive` / `negative` | Éxito y error. |

**El acento es latón (`#c8a96a`), no oro.** Un dorado saturado se ve a bisutería
en pantalla; el latón desaturado aguanta al lado de fotografía. En modo claro se
oscurece a `#8a6d2f` para que siga cumpliendo contraste. Si defines un color
nuevo, defínelo **en los dos temas**.

Y úsalo con avaricia: como mucho dos o tres elementos en acento por pantalla.

## La escala tipográfica es cerrada, y su contraste es el diseño

Siete pasos y ni uno más. Un tamaño intermedio inventado para un componente es
exactamente lo que hace que una interfaz parezca ensamblada en vez de diseñada.

**La distancia entre los extremos es el diseño**: una etiqueta de 10 px con
`0.28em` de tracking contra un titular de 60 px con tracking negativo. Ahí vive
el lujo — no en un adorno, un serif o un degradado. Lo que aterriza en mitad de
la escala la debilita.

| Clase | Para |
| --- | --- |
| `text-micro` | Etiquetas en versalitas, lecturas de la barra de estado. |
| `text-label` | Pies, ayudas, metadatos. |
| `text-small` | Texto secundario y de controles. |
| `text-body` | Cuerpo. |
| `text-lead` | Cabeceras de panel y de sección. |
| `text-title` | Títulos de bloque. |
| `text-section` / `text-display` | Titulares. |

**Nunca escribas `text-[13px]`.** Si ninguno de los siete encaja, el problema es
la jerarquía, no la escala.

**Dos familias, y ya está. No hay serif.** Lo hubo, como acento de lujo, y se
quitó al subir el contraste de la escala: si el salto de tamaño hace el trabajo,
el adorno sobra y solo añade una fuente que cargar.

- **`font-sans` (Archivo)** — todo, titulares incluidos. Es la voz del producto,
  y tiene que sostener el registro ella sola. La anterior era competente y
  anónima; esta tiene autoridad.
- **`.numeric` (JetBrains Mono)** — **todas** las cifras: índices, contadores,
  duraciones, créditos, valores de la barra de estado. Ya trae `tabular-nums`;
  no añadas la clase por separado. Los índices van con `padStart(2,"0")`, porque
  `01` se lee como catálogo y `1` como formulario.

Dos clases fijan el tratamiento de los titulares, para que cada uno no se
reinvente su propio tracking:

- **`.display`** — peso 600, `-0.045em`. Para `text-display` y `text-section`.
- **`.headline`** — peso 600, `-0.03em`. Para `text-title` y `text-lead`.

`.eyebrow` es la etiqueta en versalitas con `tracking` amplio. Úsala para
encabezar secciones en vez de inventar otro tamaño.

## Forma, densidad y superficie

- **`rounded-sm` es 2 px, y es lo único que hay.** Nada es tipo píldora salvo un
  chip de estado o un punto, donde la forma *es* el significado. Los botones son
  rectángulos mecanizados.
- **`.panel`** — superficie con hairline y un brillo interior en el borde
  superior, como un panel anodizado que coge la luz. Úsalo para tarjetas y
  bloques; `shadow-elevated` queda reservado al reproductor.
- **Los inputs van sobre `surface-sunken`**, no sobre `surface`. La diferencia
  entre lo que se pulsa y lo que se rellena es de profundidad, no de borde.
- **Densidad antes que aire.** Es una herramienta profesional: la información
  cabe. Entre secciones `gap-10`/`gap-12`, no `gap-20`.
- **Fotografía en `aspect-[4/3]`.** El vídeo toma su marco de
  `reel.aspectRatio`, nunca fijo — ver más abajo.

## La barra de estado no es decoración

`AppShell` lleva una segunda fila que dice el estado de la máquina: **motor**,
**entrega** y **acceso**. Son las tres cosas que cuestan dinero o lo parecen y
que no se ven en el resultado: un clip simulado es indistinguible de uno
renderizado, y un host sin ffmpeg no entrega fichero.

Si añades una condición que el usuario debería conocer *antes* de gastar, va
ahí, con `Reading`.

## Enseñar, no describir

Las tarjetas de estilo llevan un **esquema animado** (`StylePreview`) con el
movimiento de cámara y el formato reales. Es un diagrama a línea fina, nunca una
fotografía: no debe poder confundirse con un render de muestra. Solo se anima la
tarjeta seleccionada — seis bucles a la vez es una feria.

## Movimiento

Lento y con intención. Nada rebota.

- Transiciones de 300-700 ms; `duration-1000` para cambios de estado de una
  fotografía.
- `ease-out` o `cubic-bezier(0.16, 1, 0.3, 1)`.
- Keyframes: `reel-pan` (clip simulado), `shimmer` (mientras renderiza), `rise`
  (entrada, vía `.rise`), `pulse-dot` (vía `.live-dot`, para un valor en vivo) y
  la familia `camera-*` (`push`, `orbit`, `pan`, `tilt`, `snap`, `hold`).
- `.drop-target` marca el hueco donde va a caer una foto al arrastrarla.
- **Todo lo que se mueve necesita su rama en `prefers-reduced-motion`.** Ya está
  montada en `globals.css`; si añades un keyframe, añade ahí su neutralización.

## Accesibilidad

- Los botones de icono llevan `aria-label`: el símbolo (`←`, `✕`) no es texto
  accesible.
- El estado no se comunica solo con color — el chip lleva siempre su etiqueta.
- **Arrastrar nunca es la única forma de hacer algo.** Reordenar fotos funciona
  arrastrando y con flechas, porque el arrastre no existe con teclado y es
  incómodo con el pulgar.
- No bajes de `text-micro`, y a ese tamaño solo con `tracking` amplio.
- Comprueba los dos temas antes de dar algo por hecho. El modo claro es el que
  se rompe primero.

## Cómo verificarlo

```bash
npm run dev
```

Playwright **no está instalado**: si lo quieres para capturas, añádelo primero
(`npm i -D @playwright/test`). Con o sin él, mira los cuatro estados en los dos
temas: formulario vacío, renderizando, montaje terminado y el panel de Ajustes.
El intermedio es el que más se olvida y el que más ve el usuario.

El tema claro ya **no** se alcanza con `colorScheme` de Playwright ni cambiando
el sistema: es un `data-theme="light"` en el `<html>`, así que ponlo a mano o
pulsa el control de la cabecera.

Y comprueba el formato vertical. Dos de los seis estilos son 9:16, y el
reproductor toma el marco de `reel.aspectRatio` — si lo vuelves a fijar a
`aspect-video`, recortas justo los estilos pensados para el móvil.
