import type {
  PropertyType,
  ResolvedPrompt,
  SceneType,
  StyleId,
} from "@/types/video";
import { SCENE_LIST, SCENE_PROFILES, isSceneType } from "@/lib/prompts/scenes";
import { STYLE_LIST, getStyle } from "@/lib/prompts/styles";
import { getProperty } from "@/lib/prompts/properties";

export { SCENE_PROFILES, SCENE_LIST, isSceneType } from "@/lib/prompts/scenes";
export {
  STYLE_PRESETS,
  STYLE_LIST,
  DEFAULT_STYLE_ID,
  isStyleId,
  getStyle,
} from "@/lib/prompts/styles";
export {
  classifyPhoto,
  sceneFromFilename,
  suggestSceneType,
} from "@/lib/prompts/classify";
export {
  PROPERTY_PROFILES,
  PROPERTY_LIST,
  DEFAULT_PROPERTY_TYPE,
  isPropertyType,
  getProperty,
} from "@/lib/prompts/properties";

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

export interface BuildPromptInput {
  styleId?: StyleId | string;
  sceneType?: SceneType | string;
  propertyType?: PropertyType | string;
  /** Free text from the user. */
  extra?: string;
}

/**
 * Compose the final prompt for one clip from the three axes.
 *
 * Order matters — the model weights early clauses more heavily, so it runs
 * style → property → scene motion → user's own words → hard constraints:
 *
 * 1. `base`      the overall treatment (how the reel feels)
 * 2. `context`   what kind of building this is
 * 3. `motion`    what this frame can take (scene override wins over default)
 * 4. `extra`     whatever the user typed, so they can always steer
 * 5. constraints the non-negotiables, last so nothing dilutes them
 *
 * The property context sits early and deliberately: it is what stops "orbit
 * the building exterior" being applied to a third-floor flat.
 *
 * Returns the negative prompt separately: providers that support a dedicated
 * negative field give much better results with it than with "no X" folded into
 * the positive prompt, and `higgsfield.ts` decides how to send it.
 */
export function buildClipPrompt({
  styleId,
  sceneType,
  propertyType,
  extra,
}: BuildPromptInput): ResolvedPrompt {
  const style = getStyle(styleId);
  const property = getProperty(propertyType);
  const scene = isSceneType(sceneType)
    ? SCENE_PROFILES[sceneType]
    : SCENE_PROFILES.generico;

  const override = style.sceneOverrides?.[scene.id];
  const motion = override ?? scene.motion;

  const parts = [style.base, property.context, motion];

  const trimmedExtra = extra?.trim();
  if (trimmedExtra) parts.push(trimmedExtra);

  parts.push(UNIVERSAL_CONSTRAINTS);

  return {
    prompt: parts.join(", "),
    negative: style.negative,
    styleId: style.id,
    sceneType: scene.id,
    propertyType: property.id,
    aspectRatio: style.aspectRatio,
    durationSeconds: style.durationSeconds,
  };
}

/**
 * Scenes ordered for a property type: the ones it actually has first, then
 * everything else. Nothing is removed — a flat in a development can still have
 * communal areas, and a wrong whitelist is worse than a wrong order.
 */
export function scenesForProperty(propertyType: PropertyType | string | undefined) {
  const property = getProperty(propertyType);
  const primary = property.primaryScenes;

  return [...SCENE_LIST].sort((a, b) => {
    const aRank = primary.indexOf(a.id);
    const bRank = primary.indexOf(b.id);
    if (aRank !== -1 && bRank !== -1) return aRank - bRank;
    if (aRank !== -1) return -1;
    if (bRank !== -1) return 1;
    return a.order - b.order;
  });
}

/** Styles ordered for a property type, recommended ones first. */
export function stylesForProperty(propertyType: PropertyType | string | undefined) {
  const recommended = getProperty(propertyType).recommendedStyles;

  return [...STYLE_LIST]
    .map((style) => ({
      style,
      rank: recommended.indexOf(style.id),
    }))
    .sort((a, b) => {
      if (a.rank !== -1 && b.rank !== -1) return a.rank - b.rank;
      if (a.rank !== -1) return -1;
      if (b.rank !== -1) return 1;
      return 0;
    })
    .map(({ style, rank }) => ({ style, recommended: rank !== -1 }));
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
