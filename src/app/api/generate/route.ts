import { NextRequest, NextResponse } from "next/server";
import { createBatch, ValidationError } from "@/lib/pipeline";
import type { CreateBatchRequest } from "@/types/video";

/**
 * Fan out one batch: every photo becomes its own provider job.
 *
 * Returns as soon as the jobs are enqueued — rendering takes minutes, so the
 * client polls `GET /api/generate/[batchId]` from here on.
 */
export async function POST(req: NextRequest) {
  let body: CreateBatchRequest;

  try {
    body = (await req.json()) as CreateBatchRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const batch = await createBatch(body.imageUrls, body.options);
    return NextResponse.json(batch, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
