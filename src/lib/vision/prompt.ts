import type { SceneType } from "@/types/video";
import { SCENE_LIST } from "@/lib/prompts/scenes";

/**
 * What we ask a model to decide, and the shape we demand back.
 *
 * Written in English like everything else a model reads: they follow English
 * instructions far more reliably, and the Spanish in this file is only the
 * text the user will see.
 *
 * Kept apart from any one driver so a second backend asks exactly the same
 * question. Two drivers with two prompts would be two classifiers.
 */

/** The allowed answers, derived from the catalogue so they cannot drift. */
export const SCENE_IDS: SceneType[] = SCENE_LIST.map((scene) => scene.id);

/**
 * The instruction.
 *
 * Three things it is deliberately strict about:
 *
 * - **`generico` when unsure.** A wrong scene produces worse camera movement
 *   than a neutral one, so the model is told to abstain rather than guess.
 * - **Floor plans.** Every Spanish listing carries one, and animating a floor
 *   plan produces a warping diagram that the customer paid for. It is the
 *   single most valuable thing on the discard list.
 * - **No prose.** JSON only, or the parse becomes a guessing game.
 */
export const INSTRUCTION = `You are classifying one photograph from a real estate listing.

Reply with JSON only. No prose, no explanation.

"room" must be exactly one of:
${SCENE_IDS.join(", ")}

Guidance:
- fachada: the building seen from outside, its facade or entrance.
- salon: living room, sitting room, or open living-dining space.
- cocina: kitchen.
- dormitorio: bedroom.
- bano: bathroom, shower room or toilet.
- terraza: terrace or balcony.
- piscina: swimming pool.
- vistas: the view out, where the view is the subject.
- jardin: garden, lawn or plot.
- distribuidor: hallway, corridor, entrance hall or staircase.
- detalle: a close-up of one object or finish.
- comunes: shared areas — lobby, garage, gym, storage room.
- generico: USE THIS whenever you are not confident. Abstaining is correct.

"discard" must be true when the photo should NOT be turned into a video clip:
- a floor plan, blueprint, map, diagram or site plan
- a screenshot, logo, price card, or an image that is mostly text
- badly blurred, very dark, or heavily over-exposed
Otherwise false.

"reason" only when discard is true: at most eight words, in Spanish.`;

/** The schema handed to backends that can enforce one. */
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    room: { type: "string", enum: SCENE_IDS },
    discard: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["room", "discard"],
} as const;

export interface RawAnswer {
  room?: unknown;
  discard?: unknown;
  reason?: unknown;
}

/**
 * Read a model's answer, refusing anything that is not a scene we know.
 *
 * An invented room id would flow straight into the prompt resolver and pick a
 * camera movement at random, so an unrecognised value becomes `generico` —
 * the same abstention the instruction asks for.
 */
export function readAnswer(raw: RawAnswer): {
  sceneType: SceneType;
  discard: boolean;
  reason?: string;
} {
  const room = String(raw.room ?? "").trim().toLowerCase();
  const sceneType = (SCENE_IDS as string[]).includes(room)
    ? (room as SceneType)
    : "generico";

  const discard = raw.discard === true;
  const reason =
    discard && typeof raw.reason === "string" && raw.reason.trim()
      ? raw.reason.trim().slice(0, 80)
      : undefined;

  return { sceneType, discard, reason };
}
