---
name: video-styles
description: Catálogo de prompts de houseaimage — estilos de vídeo (cinematográfico, dron, dinámico, visita guiada, editorial, lifestyle) y tipos de escena por estancia. Úsala SIEMPRE antes de tocar src/lib/prompts/, al añadir o afinar un estilo o una escena, al cambiar formato o duración, y cuando los vídeos salgan con movimiento inadecuado, arquitectura deformada, ritmo equivocado o poco vendibles. También para decidir qué fotos descartar y en qué orden montar el recorrido.
---

# Catálogo de estilos y escenas

## Dos ejes, no una lista

El prompt de cada clip se compone de **dos** decisiones independientes:

```
estilo (todo el reel)  ×  escena (esta foto)  →  prompt final
```

Un solo eje no basta. El estilo dice cómo se siente el vídeo entero; la escena
dice qué aguanta ese fotograma concreto. Un paneo lateral que favorece una
encimera destroza el espejo de un baño, así que se eligen por separado y se
combinan en `buildClipPrompt`.

| Archivo | Contiene |
| --- | --- |
| `src/lib/prompts/styles.ts` | Los 6 estilos: `base`, `negative`, formato, duración, overrides. |
| `src/lib/prompts/scenes.ts` | Los 13 tipos de escena: `motion` y orden recomendado. |
| `src/lib/prompts/index.ts` | El resolutor y las restricciones universales. |

## Los prompts van en inglés. Siempre.

Los modelos de vídeo están entrenados de forma abrumadora con descripciones en
inglés y siguen el vocabulario de cámara inglés mucho mejor. Por eso:

- **`base`, `negative`, `motion`, `sceneOverrides` → inglés.** Los lee el modelo.
- **`label`, `tagline`, `bestFor`, `hint` → español.** Los lee el usuario.

Nunca traduzcas los primeros aunque la interfaz esté en español.

## Reglas para escribir un prompt

1. **Describe la cámara, no la estancia.** La estancia ya está en la foto.
   Describirla invita al modelo a redibujarla, y en un inmueble eso significa
   puertas que se doblan y encimeras que se derriten.
2. **Afirma la estabilidad arquitectónica.** Es el fallo característico de este
   caso de uso. Las restricciones universales ya lo hacen en
   `UNIVERSAL_CONSTRAINTS`; no lo repitas en cada estilo.
3. **Sé breve.** Un prompt largo diluye todas sus cláusulas.
4. **El negativo va aparte**, en su campo. Los modelos honran un negative
   prompt real mucho mejor que un "no X" metido en el positivo.

El orden de composición importa, porque el modelo pesa más lo que va primero:
`base` → `motion` → texto del usuario → restricciones.

## Overrides: cuándo hacen falta

`sceneOverrides` existe para cuando un estilo y una escena se contradicen. El
caso canónico es **dron + interior**: el lenguaje aéreo aplicado a una cocina
hace que el modelo invente una cámara imposible, así que el estilo `dron`
sobrescribe todas las escenas de interior con `no aerial ascent`.

Si añades un estilo con lenguaje muy marcado, revisa si choca con alguna escena
y sobrescríbela. Si no choca, no pongas override: el movimiento por defecto de
la escena ya está afinado.

## Añadir un estilo

1. Añade su `id` al tipo `StyleId` en `src/types/video.ts`.
2. Añade la entrada en `STYLE_PRESETS`. El `satisfies` te obliga a completar
   todos los campos — si falta uno, falla el build, no el render.
3. Elige formato y duración con criterio: 9:16 y 4-5 s para redes, 16:9 y 6-8 s
   para portales y web, 4:5 para feed.

No hace falta tocar la UI: `StylePicker` se genera desde `STYLE_LIST`.

## El formato es parte de la elección

Elegir "dinámico" es también elegir 9:16. Por eso la tarjeta del selector
enseña formato y duración: descubrirlo después de renderizar cuesta créditos.
Si añades un estilo, piensa dónde se va a publicar el vídeo.

## Qué NO se expone al cliente

`GET /api/styles` sirve el catálogo sin `base`, `negative`, `motion` ni
`sceneOverrides`. Ese texto es el oficio del producto y no debe viajar al
navegador. Si añades un campo que lee el modelo, **no lo añadas al select del
endpoint**.

## Fotos que conviene descartar

Cada foto es un job y cuesta. Antes de generar, fuera:

- Muy oscuras o a contraluz: el modelo mete ruido y artefactos.
- Con personas: caras y manos se deforman casi siempre (y el negativo ya pide
  que no aparezcan).
- Planos muy cerrados de un grifo o un enchufe: no hay espacio para mover la
  cámara. Si es un acabado que merece la pena, márcala como `detalle`.
- Fotos ya borrosas o movidas: el modelo amplifica el desenfoque.
- Planos, planos de distribución o el cartel del anuncio: no son fotogramas.

## Orden del recorrido

`suggestOrder` ordena por el campo `order` de cada escena, siguiendo el
recorrido de una visita real: fachada → salón → cocina → dormitorios → baños →
exterior. **Es una sugerencia y nunca se aplica sola**: el orden que fija el
usuario es el del vídeo, y reordenar por detrás sería peor que un montaje
mejorable.

Excepción de negocio: si el inmueble tiene un argumento único (vistas al mar,
piscina, ático), va el segundo, no el último. En vertical la decisión se toma en
los primeros segundos.

## Cómo verificar un prompt de verdad

El proveedor simulado no renderiza, así que para ver el prompt que sale hay que
mirar lo que se envía. Levanta un servidor que suplante a Higgsfield y apunta
la app a él:

```bash
VIDEO_PROVIDER=higgsfield HIGGSFIELD_API_KEY=test \
HIGGSFIELD_API_BASE_URL=http://127.0.0.1:4599 npm run dev
```

Cualquier servidor que registre el cuerpo del POST y devuelva
`{"id":"x","status":"queued"}` sirve. Así se comprueban de una vez la
composición, el negativo, el formato y la duración.
