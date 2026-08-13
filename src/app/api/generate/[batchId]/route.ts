import { NextResponse } from "next/server";
import { refreshBatch, retryFailedClips } from "@/lib/pipeline";

const NOT_FOUND = { error: "Unknown or expired batch" };

/**
 * Batch status, refreshed against the provider on every call.
 *
 * The client polls this until `status` leaves `processing`. The response is
 * the whole batch, so the UI can show per-clip progress rather than a single
 * opaque spinner for the entire listing.
 *
 * The lookup happens inside `refreshBatch`, under the batch's lock — reading
 * it here first would reintroduce the race that let two concurrent polls
 * re-submit the same failed clip twice.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/generate/[batchId]">
) {
  const { batchId } = await ctx.params;

  try {
    const batch = await refreshBatch(batchId);
    return batch
      ? NextResponse.json(batch)
      : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * Re-submit the clips that failed, keeping the ones that succeeded. Lets the
 * user rescue a `partial` reel without paying to render the whole listing again.
 */
export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/generate/[batchId]">
) {
  const { batchId } = await ctx.params;

  try {
    const batch = await retryFailedClips(batchId);
    return batch
      ? NextResponse.json(batch)
      : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
