import type { PropertyType, SceneType } from "@/types/video";
import { getProperty } from "@/lib/prompts/properties";

/**
 * Guessing what a photo shows.
 *
 * The scene is the axis that decides the camera movement, and until now it was
 * guessed from position alone: the first two photos and the last one, with
 * everything in between left neutral. On a twelve-photo listing that meant
 * nine clips rendered with generic motion — the whole scene catalogue, unused.
 *
 * The evidence we actually have is the filename. Agency exports and portal
 * downloads are named `salon-1.jpg`, `cocina.jpg`, `bano principal.jpg` far
 * more often than not, and a name that matches is real evidence rather than a
 * guess. When there is no match we fall back to position, and when position
 * has nothing to say we stay neutral — a wrong scene produces worse motion
 * than a neutral one, which is why this never invents an answer.
 *
 * ⚠️ This is a heuristic, not vision. The complete fix is a model that looks
 * at the image, and it belongs behind this same function so nothing upstream
 * has to change: `classifyPhoto` is the only thing the UI calls.
 */

/**
 * Filename fragments that identify a scene, most specific first.
 *
 * Order matters: `bano` has to be tested before `banera`-style words could
 * catch elsewhere, and `salon comedor` must not be claimed by a `comedor`
 * entry placed earlier. Spanish and English both appear because half the
 * exports are in English.
 */
const KEYWORDS: ReadonlyArray<readonly [SceneType, readonly string[]]> = [
  ["piscina", ["piscina", "pool", "alberca", "spa", "jacuzzi"]],
  ["bano", ["bano", "aseo", "bathroom", "toilet", "wc", "ducha", "lavabo"]],
  ["cocina", ["cocina", "kitchen", "office"]],
  ["dormitorio", ["dormitorio", "habitacion", "cuarto", "bedroom", "suite", "dorm"]],
  ["terraza", ["terraza", "balcon", "balcony", "terrace", "porche", "patio"]],
  ["jardin", ["jardin", "garden", "parcela", "cesped", "huerto", "exterior-jardin"]],
  ["fachada", ["fachada", "facade", "front", "exterior", "entrada-principal", "casa"]],
  ["vistas", ["vistas", "vista", "view", "panoramica", "skyline", "mar"]],
  ["comunes", ["comunes", "common", "portal", "garaje", "parking", "trastero", "gimnasio", "gym", "piscina-comunitaria"]],
  ["distribuidor", ["distribuidor", "pasillo", "recibidor", "hall", "corridor", "entrada", "escalera"]],
  ["salon", ["salon", "living", "comedor", "estar", "lounge", "dining"]],
  ["detalle", ["detalle", "detail", "chimenea", "armario", "closet"]],
];

/** Strip accents, extension and separators so `Salón_02.JPG` matches `salon`. */
function normalize(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_+.]/g, "-");
}

/**
 * The scene a filename names, if any.
 *
 * Exported on its own because it is the part worth testing directly: it is
 * pure, and every wrong answer here becomes a wrongly-moving clip.
 */
export function sceneFromFilename(fileName: string): SceneType | undefined {
  const name = normalize(fileName);

  // A camera's own name (IMG_2481, DSC00123, PXL_2024…) carries no evidence,
  // and matching a substring inside one would be pure noise.
  if (/^(img|dsc|dscn|pxl|photo|foto|image|screenshot)[-\s]?\d+$/.test(name)) {
    return undefined;
  }

  for (const [scene, fragments] of KEYWORDS) {
    if (fragments.some((fragment) => name.includes(fragment))) return scene;
  }

  return undefined;
}

/**
 * The positional guess, with no filename to go on.
 *
 * It follows the property rather than a fixed list — a house listing opens on
 * the façade, a flat opens on the living room, because it has no façade of its
 * own to show. Anything in the middle stays neutral on purpose: a wrong scene
 * produces worse motion than a neutral one.
 */
export function suggestSceneType(
  index: number,
  total: number,
  propertyType?: PropertyType | string
): SceneType {
  const primary = getProperty(propertyType).primaryScenes;

  if (index < 2) return primary[index] ?? "generico";
  // The closer of a real viewing is the argument of the property, which for
  // every profile is its third primary scene.
  if (total > 3 && index === total - 1) return primary[2] ?? "generico";

  return "generico";
}

export interface ClassifyInput {
  fileName: string;
  /** Position among the photos being added, zero-based. */
  index: number;
  total: number;
  propertyType?: PropertyType | string;
}

/** Best guess for one photo: filename first, position second, neutral last. */
export function classifyPhoto({
  fileName,
  index,
  total,
  propertyType,
}: ClassifyInput): SceneType {
  return sceneFromFilename(fileName) ?? suggestSceneType(index, total, propertyType);
}
