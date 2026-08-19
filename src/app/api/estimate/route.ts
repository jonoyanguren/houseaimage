import { NextResponse } from "next/server";
import { getVideoProvider } from "@/lib/providers";
import { getStyle } from "@/lib/prompts";
import { MAX_PHOTOS_PER_BATCH } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * What this batch would cost, before anyone commits to it.
 *
 * The engine is asked rather than the arithmetic being done here: only it
 * knows what a resolution, a second more or an audio track does to the price.
 * A backend that cannot answer returns nothing and the rail simply says
 * nothing — an absent number is better than an invented one.
 */
export async function POST(req: Request) {
  let body: { styleId?: unknown; clips?: unknown };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  }

  const clips = typeof body.clips === "number" ? body.clips : 0;
  if (clips <= 0 || clips > MAX_PHOTOS_PER_BATCH) {
    return NextResponse.json({ estimate: null });
  }

  const provider = getVideoProvider();
  if (!provider.estimateCost) return NextResponse.json({ estimate: null });

  // The style fixes the frame and the shot length, which are what the price
  // depends on — so the quote matches what pressing generate would submit.
  const style = getStyle(typeof body.styleId === "string" ? body.styleId : undefined);

  try {
    const estimate = await provider.estimateCost({
      aspectRatio: style.aspectRatio,
      durationSeconds: style.durationSeconds,
      clips,
    });

    return NextResponse.json({ estimate });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ estimate: null, error: message });
  }
}
