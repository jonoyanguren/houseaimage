import type { ResolvedPrompt, SceneType, StyleId } from "@/types/video";
import { SCENE_PROFILES, isSceneType } from "@/lib/prompts/scenes";
import { getStyle } from "@/lib/prompts/styles";

export {
  SCENE_PROFILES,
  SCENE_LIST,
  isSceneType,
  suggestSceneType,
} from "@/lib/prompts/scenes";
export {
  STYLE_PRESETS,
  STYLE_LIST,
  DEFAULT_STYLE_ID,
  isStyleId,
  getStyle,
} from "@/lib/prompts/styles";

/**
 * Shared constraints appended to every prompt regardless of style.
 *
 * These encode the one failure mode that ruins a property video specifically:
 * the model treating architecture as soft. A sofa that morphs is a bad clip; a
 * door frame that bends makes the listing look falsified.
 */
const UNIVERSAL_CONSTRAINTS =
  "architectural lines stay perfectly straight, room geometry unchanged, " +
  "furniture and fixtures remain solid and consistent, photorealistic";

/**
 * Compose the final prompt for one clip.
 *
 * Order matters — the model weights early clauses more heavily, so it runs
 * style → scene motion → user's own words → hard constraints:
 *
 * 1. `base`      the overall treatment (how the reel feels)
 * 2. `motion`    what this frame can take (scene override wins over default)
 * 3. `extra`     whatever the user typed, so they can always steer
 * 4. constraints the non-negotiables, last so nothing dilutes them
 *
 * Returns the negative prompt separately: providers that support a dedicated
 * negative field give much better results with it than with "no X" folded into
 * the positive prompt, and `higgsfield.ts` decides how to send it.
 */
export function buildClipPrompt(
  styleId: StyleId | string | undefined,
  sceneType: SceneType | string | undefined,
  extra?: string
): ResolvedPrompt {
  const style = getStyle(styleId);
  const scene = isSceneType(sceneType)
    ? SCENE_PROFILES[sceneType]
    : SCENE_PROFILES.generico;

  const override = style.sceneOverrides?.[scene.id];
  const motion = override ?? scene.motion;

  const parts = [style.base, motion];

  const trimmedExtra = extra?.trim();
  if (trimmedExtra) parts.push(trimmedExtra);

  parts.push(UNIVERSAL_CONSTRAINTS);

  return {
    prompt: parts.join(", "),
    negative: style.negative,
    styleId: style.id,
    sceneType: scene.id,
    aspectRatio: style.aspectRatio,
    durationSeconds: style.durationSeconds,
  };
}

/**
 * Recommended running order for a set of scenes, following the path of an
 * actual viewing: arrive, see the main room, then the rest, then the closer.
 *
 * Only used to offer the user a reorder — it never reorders on its own,
 * because the order they set is the order of the video and overriding that
 * silently would be worse than a suboptimal cut.
 */
export function suggestOrder<T extends { sceneType?: SceneType }>(
  items: T[]
): T[] {
  return [...items]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aOrder = a.item.sceneType
        ? SCENE_PROFILES[a.item.sceneType].order
        : SCENE_PROFILES.generico.order;
      const bOrder = b.item.sceneType
        ? SCENE_PROFILES[b.item.sceneType].order
        : SCENE_PROFILES.generico.order;
      // Stable: equal scene types keep the user's relative order.
      return aOrder - bOrder || a.index - b.index;
    })
    .map(({ item }) => item);
}
