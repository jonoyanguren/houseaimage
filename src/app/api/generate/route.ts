import { NextRequest, NextResponse } from "next/server";
import { createBatch, toPublicBatch, ValidationError } from "@/lib/engine";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import { BATCH_LIMIT_PER_HOUR } from "@/lib/config";
import type { CreateBatchRequest } from "@/types/video";

const BATCH_WINDOW_MS = 60 * 60_000;

/**
 * Fan out one batch: every photo becomes its own provider job.
 *
 * Returns as soon as the jobs are enqueued — rendering takes minutes, so the
 * client polls `GET /api/generate/[batchId]` from here on.
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(
    `batch:${clientKey(req)}`,
    BATCH_LIMIT_PER_HOUR,
    BATCH_WINDOW_MS
  );

  if (!limit.ok) {
    return NextResponse.json(
      {
        // Named as ours on purpose. The first version of this message read
        // like a provider quota, and someone spent a morning looking for a
        // problem at Higgsfield that was in this file.
        error:
          `Límite propio de esta aplicación: ${BATCH_LIMIT_PER_HOUR} lotes por hora. ` +
          "Súbelo con BATCH_LIMIT_PER_HOUR si estás probando.",
      },
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
