import { NextResponse } from "next/server";
import { setVision } from "@/lib/settings";
import { __resetModelCache, listModels, warmUp } from "@/lib/vision";
import type { VisionSettings } from "@/types/vision";

export const dynamic = "force-dynamic";

/**
 * The models the local server actually holds.
 *
 * Offered as a list rather than a text box because most models cannot see, and
 * handing an image to a text-only one produces confident nonsense instead of an
 * error. The picker greys those out, so the mistake is unavailable.
 */
export async function GET(req: Request) {
  const baseUrl = new URL(req.url).searchParams.get("baseUrl") ?? undefined;

  try {
    return NextResponse.json({ models: await listModels(baseUrl) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json(
      {
        error:
          `No se pudo hablar con Ollama: ${message}. ` +
          "Comprueba que está en marcha (ollama serve) y la dirección.",
      },
      { status: 502 }
    );
  }
}

/** Save the classifier configuration. */
export async function PATCH(req: Request) {
  let patch: Partial<VisionSettings>;

  try {
    patch = (await req.json()) as Partial<VisionSettings>;
  } catch {
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  }

  const driver =
    patch.driver === "ollama" || patch.driver === "heuristic" ? patch.driver : undefined;

  const vision = setVision({
    driver,
    baseUrl: typeof patch.baseUrl === "string" ? patch.baseUrl.slice(0, 200) : undefined,
    model: typeof patch.model === "string" ? patch.model.slice(0, 120) : undefined,
  });

  // A model may have been pulled again since we last asked what it can do.
  __resetModelCache();

  // Pay the cold load now, while the operator is still looking at the panel,
  // instead of in front of the first photograph they upload.
  if (vision.driver === "ollama") {
    void warmUp({ baseUrl: vision.baseUrl, model: vision.model });
  }

  return NextResponse.json({ vision });
}
