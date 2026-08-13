import type { SceneProfile, SceneType } from "@/types/video";

/**
 * Scene catalogue: what the photo shows, and therefore how the camera should
 * move through it.
 *
 * This is the second axis of the prompt system. The style says how the whole
 * reel feels; the scene says what this particular frame can take. A lateral
 * pan that flatters a kitchen counter destroys a bathroom mirror, so the two
 * have to be chosen separately and combined at render time.
 *
 * `motion` is written in English on purpose — the video models are trained
 * overwhelmingly on English captions and follow English camera vocabulary far
 * more reliably. The Spanish text is what the user reads; the English text is
 * what the model reads. Do not translate `motion`.
 */
export const SCENE_PROFILES = {
  fachada: {
    id: "fachada",
    label: "Fachada / exterior",
    hint: "Sitúa el inmueble. Abre siempre el recorrido.",
    order: 10,
    motion:
      "very slow orbital drift around the building exterior, revealing its volume, steady horizon",
  },
  salon: {
    id: "salon",
    label: "Salón",
    hint: "El gancho. Va pronto y se vende por amplitud.",
    order: 20,
    motion:
      "slow forward dolly into the living space, revealing depth, eye-level height",
  },
  cocina: {
    id: "cocina",
    label: "Cocina",
    hint: "Paneo lateral: recorre la encimera sin deformar electrodomésticos.",
    order: 30,
    motion:
      "smooth horizontal pan along the countertop, constant speed, level camera",
  },
  dormitorio: {
    id: "dormitorio",
    label: "Dormitorio",
    hint: "Movimiento mínimo. Un plano amplio lo hace parecer pequeño.",
    order: 40,
    motion:
      "very subtle push-in toward the bed, intimate framing, minimal displacement",
  },
  bano: {
    id: "bano",
    label: "Baño",
    hint: "Tilt vertical: los espejos se rompen con el movimiento lateral.",
    order: 50,
    motion:
      "gentle vertical tilt, almost no lateral movement, mirror reflections stay coherent",
  },
  terraza: {
    id: "terraza",
    label: "Terraza / balcón",
    hint: "Lo que se vende es lo que se ve desde ahí.",
    order: 60,
    motion:
      "forward dolly toward the view beyond the railing, opening onto the exterior",
  },
  piscina: {
    id: "piscina",
    label: "Piscina",
    hint: "Deslizamiento sobre el agua; evita el oleaje artificial.",
    order: 65,
    motion:
      "slow glide across the pool surface, calm water, no artificial ripples",
  },
  vistas: {
    id: "vistas",
    label: "Vistas",
    hint: "Si son el argumento del inmueble, colócalas de las primeras.",
    order: 70,
    motion:
      "slow forward movement toward the horizon, expansive framing, steady horizon line",
  },
  jardin: {
    id: "jardin",
    label: "Jardín / parcela",
    hint: "Lateral lento para dar idea de superficie.",
    order: 75,
    motion: "slow lateral tracking across the garden, conveying ground area",
  },
  distribuidor: {
    id: "distribuidor",
    label: "Pasillo / distribuidor",
    hint: "Plano de transición. Encadena bien entre estancias.",
    order: 80,
    motion:
      "smooth forward tracking through the hallway at walking pace, continuous motion",
  },
  detalle: {
    id: "detalle",
    label: "Detalle / material",
    hint: "Acabados, carpintería, suelo. Muy poco recorrido.",
    order: 85,
    motion:
      "very slow macro push-in on the material detail, shallow depth of field",
  },
  comunes: {
    id: "comunes",
    label: "Zonas comunes",
    hint: "Portal, gimnasio, garaje. Cierra o sirve de apoyo.",
    order: 90,
    motion: "wide slow pan across the shared area, even lighting",
  },
  generico: {
    id: "generico",
    label: "Sin especificar",
    hint: "Movimiento neutro y seguro para cualquier estancia.",
    order: 95,
    motion: "slow subtle forward drift, neutral framing, stable camera",
  },
} as const satisfies Record<SceneType, SceneProfile>;

export const SCENE_LIST: SceneProfile[] = Object.values(SCENE_PROFILES);

export function isSceneType(value: unknown): value is SceneType {
  return typeof value === "string" && value in SCENE_PROFILES;
}
