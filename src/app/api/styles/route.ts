import { NextResponse } from "next/server";
import { SCENE_LIST, STYLE_LIST, DEFAULT_STYLE_ID } from "@/lib/prompts";

/**
 * The prompt catalogue, as JSON for the client.
 *
 * The model-facing text (`base`, `negative`, `motion`, `sceneOverrides`) is
 * deliberately stripped. It is the product's actual craft, it is worth money,
 * and shipping it to the browser puts it one devtools tab away from anyone.
 * The client only needs enough to render a chooser.
 *
 * Pure data with no request-time input, so it prerenders as a static asset.
 */
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({
    defaultStyleId: DEFAULT_STYLE_ID,
    styles: STYLE_LIST.map(
      ({ id, label, tagline, bestFor, aspectRatio, durationSeconds }) => ({
        id,
        label,
        tagline,
        bestFor,
        aspectRatio,
        durationSeconds,
      })
    ),
    scenes: SCENE_LIST.map(({ id, label, hint, order }) => ({
      id,
      label,
      hint,
      order,
    })),
  });
}
