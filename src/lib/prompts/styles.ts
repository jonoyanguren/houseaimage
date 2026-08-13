import type { StylePreset, StyleId } from "@/types/video";

/**
 * Style catalogue: the treatment applied to the whole reel.
 *
 * Kept as plain data (no logic) so it can be edited without touching the
 * pipeline, served as JSON over `GET /api/styles`, and later moved to a CMS or
 * a database by swapping this one module. `satisfies` gives it compile-time
 * validation that a raw .json file could not: a typo in a style id or a
 * missing field fails the build instead of failing at render time, in front of
 * a paying user.
 *
 * As in `scenes.ts`, everything the model reads (`base`, `negative`,
 * `sceneOverrides`) is written in English and everything the user reads is in
 * Spanish. Do not translate the model-facing fields.
 *
 * Prompt-writing rules for anything added here:
 * - Describe the CAMERA, never the room. The room is already in the photo, and
 *   describing it invites the model to redraw it.
 * - Always assert architectural stability. Warped door frames and melting
 *   worktops are the characteristic failure of this use case.
 * - Keep it short. A long prompt dilutes every clause in it.
 */
export const STYLE_PRESETS = {
  cinematografico: {
    id: "cinematografico",
    label: "Cinematográfico",
    tagline: "Lento, elegante, con peso.",
    bestFor: ["Obra nueva de lujo", "Villas y áticos", "Portales premium"],
    aspectRatio: "16:9",
    durationSeconds: 7,
    base:
      "cinematic real estate footage, slow deliberate camera movement, smooth gimbal glide, " +
      "natural light, soft filmic color grading, shallow depth of field, steady horizon",
    negative:
      "no people, no text or watermarks, no warping walls windows or door frames, " +
      "no morphing furniture, no rapid or shaky motion, no fisheye distortion",
    sceneOverrides: {
      detalle: "extremely slow macro push-in, pronounced shallow depth of field",
    },
  },

  dron: {
    id: "dron",
    label: "Dron / aéreo",
    tagline: "Muestra el entorno y la parcela.",
    bestFor: ["Chalets y fincas", "Parcelas", "Edificios completos"],
    aspectRatio: "16:9",
    durationSeconds: 8,
    base:
      "aerial drone real estate footage, smooth flight path, slow ascending reveal, " +
      "wide establishing framing, steady horizon, natural daylight, crisp detail",
    negative:
      "no people, no text or watermarks, no warping architecture, no rapid banking, " +
      "no propeller or drone visible, no motion blur",
    sceneOverrides: {
      // Indoor frames have no aerial reading; keep them grounded rather than
      // letting the aerial language invent an impossible camera.
      salon: "slow elevated forward glide through the interior, no aerial ascent",
      cocina: "slow elevated lateral glide along the counter, no aerial ascent",
      dormitorio: "slow elevated push-in, no aerial ascent",
      bano: "gentle elevated tilt, no aerial ascent",
      detalle: "slow controlled push-in, no aerial ascent",
    },
  },

  dinamico: {
    id: "dinamico",
    label: "Dinámico / social",
    tagline: "Ritmo alto para Reels y TikTok.",
    bestFor: ["Redes sociales", "Alquiler joven", "Captación rápida"],
    aspectRatio: "9:16",
    durationSeconds: 4,
    base:
      "energetic real estate reel, confident push-in, moderate speed camera move, " +
      "subtle handheld micro-movement, vibrant natural color, punchy contrast",
    negative:
      "no people, no text or watermarks, no warping architecture, no chaotic shake, " +
      "no strobing, no motion sickness",
  },

  tour: {
    id: "tour",
    label: "Visita guiada",
    tagline: "Como si recorrieras el piso.",
    bestFor: ["Pisos y apartamentos", "Visitas virtuales", "Portales"],
    aspectRatio: "16:9",
    durationSeconds: 5,
    base:
      "real estate walkthrough footage, forward dolly at walking pace, eye-level height, " +
      "continuous smooth motion, natural interior light, consistent perspective",
    negative:
      "no people, no text or watermarks, no warping walls or doorways, " +
      "no floating or drifting camera, no abrupt direction changes",
  },

  editorial: {
    id: "editorial",
    label: "Editorial",
    tagline: "Contenido, sobrio, de revista.",
    bestFor: ["Interiorismo", "Arquitectura de autor", "Lujo discreto"],
    aspectRatio: "4:5",
    durationSeconds: 6,
    base:
      "architectural digest style footage, minimal restrained camera movement, " +
      "very slow push-in, composed static framing, soft natural light, muted refined color",
    negative:
      "no people, no text or watermarks, no warping architecture, no dramatic movement, " +
      "no oversaturated color, no lens flare",
  },

  lifestyle: {
    id: "lifestyle",
    label: "Lifestyle turístico",
    tagline: "Cálido, luminoso, apetecible.",
    bestFor: ["Alquiler vacacional", "Airbnb y Booking", "Segunda residencia"],
    aspectRatio: "9:16",
    durationSeconds: 5,
    base:
      "warm inviting holiday rental footage, gentle floating camera movement, " +
      "golden natural light, airy bright atmosphere, soft highlights, relaxed pace",
    negative:
      "no people, no text or watermarks, no warping architecture, no cold or clinical tone, " +
      "no harsh shadows",
  },
} as const satisfies Record<StyleId, StylePreset>;

export const STYLE_LIST: StylePreset[] = Object.values(STYLE_PRESETS);

export const DEFAULT_STYLE_ID: StyleId = "cinematografico";

export function isStyleId(value: unknown): value is StyleId {
  return typeof value === "string" && value in STYLE_PRESETS;
}

export function getStyle(styleId: string | undefined): StylePreset {
  return isStyleId(styleId)
    ? STYLE_PRESETS[styleId]
    : STYLE_PRESETS[DEFAULT_STYLE_ID];
}
