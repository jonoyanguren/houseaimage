import type { PropertyProfile, PropertyType } from "@/types/video";

/**
 * Property catalogue: the third axis.
 *
 * Style says how the reel feels, scene says what this frame can take, and
 * property type says what kind of building we are in. It changes three things,
 * and only the first of them is prompt text:
 *
 * 1. `context` — a short clause so the model knows it is animating an
 *    apartment interior rather than a detached house. Without it, the same
 *    "slow orbital drift around the building exterior" gets applied to a
 *    third-floor flat, where there is no building to orbit.
 * 2. `recommendedStyles` — a drone reel is the obvious choice for a country
 *    property and close to useless for a one-bedroom flat.
 * 3. `primaryScenes` — a flat rarely has a pool or a garden, and surfacing
 *    those first makes the classifier feel wrong. Scenes are never hidden,
 *    only reordered: a flat in a development really can have communal ones.
 *
 * As everywhere in this directory: `context` is model-facing and stays in
 * English; the rest is user-facing Spanish.
 */
export const PROPERTY_PROFILES = {
  piso: {
    id: "piso",
    label: "Piso / apartamento",
    hint: "Interior en un edificio. Sin fachada propia ni parcela.",
    context: "apartment interior in a residential building",
    recommendedStyles: ["tour", "dinamico", "editorial"],
    primaryScenes: [
      "salon",
      "cocina",
      "dormitorio",
      "bano",
      "terraza",
      "distribuidor",
      "vistas",
      "detalle",
      "comunes",
    ],
  },

  casa: {
    id: "casa",
    label: "Casa / chalet",
    hint: "Vivienda independiente, con exterior propio.",
    context: "detached house with its own exterior grounds",
    recommendedStyles: ["dron", "cinematografico", "tour"],
    primaryScenes: [
      "fachada",
      "salon",
      "cocina",
      "dormitorio",
      "bano",
      "jardin",
      "piscina",
      "terraza",
      "vistas",
      "detalle",
    ],
  },

  atico: {
    id: "atico",
    label: "Ático / dúplex",
    hint: "El argumento suele ser la terraza y las vistas.",
    context: "penthouse apartment with a large private terrace",
    recommendedStyles: ["cinematografico", "lifestyle", "dinamico"],
    primaryScenes: [
      "terraza",
      "vistas",
      "salon",
      "cocina",
      "dormitorio",
      "bano",
      "detalle",
      "distribuidor",
    ],
  },

  rustico: {
    id: "rustico",
    label: "Finca / casa rural",
    hint: "Manda la parcela y el entorno, no los metros construidos.",
    context: "rural country property surrounded by open land",
    recommendedStyles: ["dron", "lifestyle", "cinematografico"],
    primaryScenes: [
      "fachada",
      "jardin",
      "vistas",
      "salon",
      "piscina",
      "cocina",
      "dormitorio",
      "bano",
      "detalle",
    ],
  },

  obraNueva: {
    id: "obraNueva",
    label: "Obra nueva",
    hint: "Promoción sin habitar: acabados y zonas comunes.",
    context: "newly built unfurnished property with clean modern finishes",
    recommendedStyles: ["editorial", "cinematografico", "tour"],
    primaryScenes: [
      "fachada",
      "salon",
      "cocina",
      "bano",
      "dormitorio",
      "comunes",
      "detalle",
      "terraza",
    ],
  },
} as const satisfies Record<PropertyType, PropertyProfile>;

export const PROPERTY_LIST: PropertyProfile[] = Object.values(PROPERTY_PROFILES);

export const DEFAULT_PROPERTY_TYPE: PropertyType = "piso";

export function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === "string" && value in PROPERTY_PROFILES;
}

export function getProperty(propertyType: string | undefined): PropertyProfile {
  return isPropertyType(propertyType)
    ? PROPERTY_PROFILES[propertyType]
    : PROPERTY_PROFILES[DEFAULT_PROPERTY_TYPE];
}
