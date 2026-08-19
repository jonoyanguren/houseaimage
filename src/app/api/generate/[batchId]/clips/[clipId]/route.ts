import { NextResponse } from "next/server";
import { regenerateClip, toPublicBatch, ValidationError } from "@/lib/engine";

/**
 * Re-render a single shot.
 *
 * The difference from `POST /api/generate/[batchId]` matters to the bill: that
 * one re-submits everything that failed, this one re-renders exactly the clip
 * the user pointed at — including one that came out fine but wrong. It is the
 * "I don't like this shot" action, and it costs one job.
 */
export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/generate/[batchId]/clips/[clipId]">
) {
  const { batchId, clipId } = await ctx.params;

  try {
    const batch = await regenerateClip(batchId, clipId);
    return batch
      ? NextResponse.json(toPublicBatch(batch))
      : NextResponse.json({ error: "Unknown or expired batch" }, { status: 404 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
