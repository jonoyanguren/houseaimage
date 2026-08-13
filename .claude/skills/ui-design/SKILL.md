---
name: ui-design
description: Sistema de diseño de houseaimage — tokens de color, tipografía, espaciado y movimiento del estilo editorial de lujo. Úsala SIEMPRE antes de añadir o modificar pantallas, componentes o estilos en src/app y src/components, al tocar globals.css, y cuando algo desentone, se vea genérico, falle en modo claro u oscuro, o haya que elegir colores, tamaños de texto o animaciones.
---

# Sistema de diseño

El registro es **editorial de lujo**: catálogo de inmobiliaria de gama alta, no
panel de SaaS. Si un componente nuevo parece un dashboard, está mal.

## Nunca uses un color literal

Todo el color sale de tokens definidos en `globals.css` y expuestos como
utilidades Tailwind. Un `bg-zinc-900` o un `#fff` en un componente es un bug:
rompe el modo claro, que no es un extra sino un tema de primera.

| Token | Uso |
| --- | --- |
| `canvas` | Fondo de página. |
| `surface` / `surface-raised` | Tarjetas, inputs, zonas elevadas. |
| `line` / `line-strong` | Bordes y reglas. `line` por defecto; `line-strong` en hover o activo. |
| `ink` | Texto principal. |
| `muted` | Texto secundario. |
| `faint` | Etiquetas, metadatos, texto terciario. |
| `accent` | Latón. Solo para lo que de verdad manda. |
| `accent-ink` | Texto sobre `accent`. |
| `positive` / `negative` | Éxito y error. |

**El acento es latón (`#c8a96a`), no oro.** Un dorado saturado se ve a bisutería
en pantalla; el latón desaturado aguanta al lado de fotografía. En modo claro se
oscurece a `#8a6d2f` para que siga cumpliendo contraste sobre marfil — si
defines un color nuevo, defínelo **en los dos temas**.

Y úsalo con avaricia: en una pantalla debería haber como mucho dos o tres
elementos en acento. Si todo destaca, no destaca nada.

## Tipografía

- **`font-display`** (Instrument Serif) — titulares, nombres de escena, cifras
  con peso. La cursiva es para el remate de un titular, no para texto corrido.
- **`font-sans`** (Geist) — todo el texto de interfaz.
- **`font-mono`** (Geist Mono) — números: índices, contadores, tiempos. Siempre
  con `tabular-nums` para que no bailen al actualizarse, y con `padStart(2,"0")`
  porque `01` se lee como catálogo y `1` como formulario.

La clase `.eyebrow` es la etiqueta en versalitas con `tracking` amplio. Úsala
para encabezar secciones en vez de inventar otro tamaño de texto.

Los tamaños van en pasos concretos: `text-[13px]` para texto secundario,
`text-[15px]` para el cuerpo, y la escala `display` para titulares. No metas un
tamaño intermedio nuevo sin motivo.

## Forma y espacio

- **`rounded-sm`, nunca `rounded-xl`.** El radio pequeño es lo que separa el
  registro editorial del registro app.
- **Fotografía en `aspect-[4/3]`, vídeo en `aspect-video`.** Consistente en
  toda la app.
- **El espacio es el material principal.** Entre secciones se respira
  (`gap-20`), y los titulares llevan aire por encima. Si una pantalla se ve
  apretada, casi siempre sobra contenido, no falta espacio.
- **Bordes hairline, no sombras.** `shadow-elevated` existe para el reproductor
  y poco más.

## Movimiento

Lento y con intención. Nada rebota.

- Transiciones de 300-700 ms; `duration-1000` para cambios de estado de una
  fotografía.
- `ease-out` o `cubic-bezier(0.16, 1, 0.3, 1)`.
- Keyframes disponibles: `reel-pan` (paneo del clip simulado), `shimmer`
  (destello mientras renderiza), `rise` (entrada de un elemento, vía `.rise`).
- **Todo lo que se mueve necesita su rama en `prefers-reduced-motion`.** Ya
  está montada en `globals.css`; si añades un keyframe, añade su neutralización
  ahí mismo.

## Accesibilidad

- Los botones de icono llevan `aria-label`: el símbolo (`←`, `✕`) no es texto
  accesible.
- El estado no se comunica solo con color — el chip de estado lleva siempre su
  etiqueta escrita.
- No bajes de `text-[11px]`, y a ese tamaño solo con `tracking` amplio.
- Comprueba los dos temas antes de dar algo por hecho. El modo claro es el que
  se rompe primero.

## Cómo verificarlo

El proyecto no tiene tests visuales, así que mira la pantalla:

```bash
npm run dev
```

Y con Playwright, capturando en ambos esquemas
(`colorScheme: "dark" | "light"`), revisa los tres estados que existen:
formulario vacío, renderizando y montaje terminado. El estado intermedio es el
que más se olvida y el que más ve el usuario.
