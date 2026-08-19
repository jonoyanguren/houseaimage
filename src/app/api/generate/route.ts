import { NextRequest, NextResponse } from "next/server";
import { createBatch, toPublicBatch, ValidationError } from "@/lib/engine";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import type { CreateBatchRequest } from "@/types/video";

/**
 * Batches per client per hour. This is the endpoint that spends money: each
 * one fans out to as many provider jobs as there are photos, so a loop here is
 * a bill. Generous for a working agent, useless for a script.
 */
const BATCH_LIMIT = 20;
const BATCH_WINDOW_MS = 60 * 60_000;

/**
 * Fan out one batch: every photo becomes its own provider job.
 *
 * Returns as soon as the jobs are enqueued — rendering takes minutes, so the
 * client polls `GET /api/generate/[batchId]` from here on.
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`batch:${clientKey(req)}`, BATCH_LIMIT, BATCH_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Has alcanzado el límite de lotes por hora." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: CreateBatchRequest;

  try {
    body = (await req.json()) as CreateBatchRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const batch = await createBatch(body.photos, body.options);
    return NextResponse.json(toPublicBatch(batch), { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
