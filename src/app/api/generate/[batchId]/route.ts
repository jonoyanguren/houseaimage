import { NextResponse } from "next/server";
import { getBatch } from "@/lib/jobStore";
import { refreshBatch, retryFailedClips } from "@/lib/pipeline";

/**
 * Batch status, refreshed against the provider on every call.
 *
 * The client polls this until `status` leaves `processing`. The response is
 * the whole batch, so the UI can show per-clip progress rather than a single
 * opaque spinner for the entire listing.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/generate/[batchId]">
) {
  const { batchId } = await ctx.params;
  const batch = await getBatch(batchId);

  if (!batch) {
    return NextResponse.json(
      { error: "Unknown or expired batch" },
      { status: 404 }
    );
  }

  try {
    return NextResponse.json(await refreshBatch(batch));
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
  const batch = await getBatch(batchId);

  if (!batch) {
    return NextResponse.json(
      { error: "Unknown or expired batch" },
      { status: 404 }
    );
  }

  try {
    return NextResponse.json(await retryFailedClips(batch));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
