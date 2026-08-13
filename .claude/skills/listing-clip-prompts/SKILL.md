---
name: listing-clip-prompts
description: Cómo escribir los prompts de movimiento y elegir preset, duración y orden de las fotos para que los clips de un inmueble queden vendibles en houseaimage. Úsala al ajustar los prompts por defecto, los presets o `DEFAULT_CLIP_SECONDS`, al montar el orden de las escenas, o cuando los vídeos salgan con movimiento raro, deformaciones en muebles y ventanas, o simplemente poco atractivos para el anuncio.
---

# Prompts para clips de inmuebles

El pipeline puede ser perfecto y el vídeo seguir sin vender. Esto va de la
calidad del resultado, no de la arquitectura (para eso, `video-pipeline`).

## La regla que más importa

En image-to-video, **el prompt describe el movimiento de la cámara, no la
escena**. La escena ya está en la foto. Cuanto más intentes describir lo que se
ve, más margen le das al modelo para reinventarlo — y en una foto de un piso,
reinventar significa puertas que se doblan, encimeras que se derriten y
ventanas que cambian de sitio.

```
✅ "travelling lento hacia delante, cámara a la altura del pecho, estable"
❌ "un salón luminoso y acogedor con sofá gris y grandes ventanales"
```

La segunda invita al modelo a redibujar el salón. La primera le dice qué hacer
con el que ya tiene.

## Movimientos que funcionan por estancia

| Estancia | Movimiento | Por qué |
| --- | --- | --- |
| Salón | Travelling lento hacia delante | Da sensación de amplitud, que es lo que se vende. |
| Cocina | Paneo horizontal suave | Recorre la encimera sin deformar los electrodomésticos. |
| Dormitorio | Push-in muy leve | Íntimo; un movimiento amplio lo hace parecer pequeño. |
| Baño | Tilt suave hacia arriba | Los espejos se rompen con cualquier movimiento lateral. |
| Terraza / exterior | Travelling hacia la vista | Lo que se vende es lo que se ve desde ahí. |
| Fachada | Órbita muy lenta | Da volumen; rápido parece un videojuego. |

## Qué añadir siempre

Estabilidad explícita. Los modelos exageran el movimiento por defecto:

> "…movimiento sutil, cámara estable, sin distorsión de la arquitectura,
> líneas rectas"

Y para el lote entero, el prompt va en `options.prompt` y se aplica a **todos**
los clips (`page.tsx` → `generate`). Escríbelo genérico y de cámara; si un
prompt solo tiene sentido para una estancia, no es un prompt de lote.

## Duración

`DEFAULT_CLIP_SECONDS` está en 5 por una razón: son suficientes para que se lea
la estancia y pocos para que el modelo no empiece a inventar. Por debajo de 3
no da tiempo a percibir el movimiento; por encima de 8 la deriva del modelo se
nota y el reel se hace largo.

Un anuncio se ve en redes: **8-10 clips, 40-50 segundos** es el rango útil. Con
20 fotos nadie llega al final — por eso `MAX_PHOTOS_PER_BATCH` acota, y por eso
merece la pena sugerir al usuario que seleccione, no que suba todo el carrete.

## Orden de las escenas

El orden del montaje es el que el usuario fija en el dropzone, y vende más si
sigue el recorrido de una visita real:

1. Fachada o entrada — sitúa
2. Salón — el gancho, la estancia más fuerte primero
3. Cocina
4. Dormitorios
5. Baños
6. Terraza, vistas o exterior — el cierre memorable

Si el inmueble tiene un argumento único (vistas al mar, piscina, un ático),
va **el segundo**, no el último: en vertical la gente decide en los primeros
segundos.

## Fotos que no sirven

Descártalas antes de gastar un job — cada foto es un job:

- Muy oscuras o a contraluz: el modelo mete ruido y artefactos.
- Con personas: caras y manos se deforman casi siempre.
- Planos muy cerrados (un grifo, un enchufe): no hay espacio para mover cámara.
- Planos ya en movimiento o borrosos: el modelo amplifica el desenfoque.
- Capturas de planos o el propio cartel del anuncio: no son fotogramas de vídeo.
