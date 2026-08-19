import { NextResponse } from "next/server";
import { getUsableAnalyzer, heuristicAnalyzer } from "@/lib/vision";
import { getVision } from "@/lib/settings";
import { isPropertyType } from "@/lib/prompts";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import type { AnalyzablePhoto } from "@/types/vision";

export const dynamic = "force-dynamic";

/**
 * What a photo shows, decided one photo at a time.
 *
 * One request per photograph rather than one for the batch, which is the whole
 * reason the interface feels alive: a local model takes seconds per image, and
 * twenty photos answered together is half a minute of nothing followed by
 * everything at once. Answered one by one, the room labels fill in as the
 * model works.
 *
 * It never fails. Any problem — no model, model down, model talking nonsense —
 * comes back as the filename heuristic with `source: "heuristic"`, and the
 * interface says which one answered rather than pretending they are equal.
 */

/** Twenty photos a batch, twenty batches an hour, and room to spare. */
const CLASSIFY_LIMIT = 500;
const CLASSIFY_WINDOW_MS = 60 * 60_000;

/** A 640px JPEG is well under this; anything larger is a full-size original. */
const MAX_DATA_URL_CHARS = 2_000_000;

export async function POST(req: Request) {
  const limit = rateLimit(
    `classify:${clientKey(req)}`,
    CLASSIFY_LIMIT,
    CLASSIFY_WINDOW_MS
  );
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Demasiadas clasificaciones seguidas." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  }

  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  if (!dataUrl.startsWith("data:image/") || dataUrl.length > MAX_DATA_URL_CHARS) {
    return NextResponse.json({ error: "Imagen no válida" }, { status: 400 });
  }

  const photo: AnalyzablePhoto = {
    dataUrl,
    fileName: typeof body.fileName === "string" ? body.fileName : "",
    index: typeof body.index === "number" ? body.index : 0,
    total: typeof body.total === "number" ? body.total : 1,
    propertyType: isPropertyType(body.propertyType) ? body.propertyType : undefined,
  };

  try {
    const analyzer = await getUsableAnalyzer(getVision());
    return NextResponse.json(await analyzer.analyze(photo));
  } catch {
    // The analyzers already swallow their own failures; this is the belt to
    // that pair of braces, so a classification can never break an upload.
    return NextResponse.json(await heuristicAnalyzer.analyze(photo));
  }
}
