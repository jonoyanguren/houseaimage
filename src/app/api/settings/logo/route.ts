import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { setBrand } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** A logo is a small asset; anything larger is a photo pasted by mistake. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * Upload the agency logo, which ffmpeg later burns into the closing card and
 * the watermark. Stored through the same `StorageProvider` as the photos, so
 * it moves to an object store with them.
 */
export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No se ha enviado ningún fichero" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "El logotipo debe ser una imagen" }, { status: 400 });
  }
  if (file.size > MAX_LOGO_BYTES) {
    return NextResponse.json(
      { error: `El logotipo supera los ${MAX_LOGO_BYTES / 1024 / 1024} MB` },
      { status: 413 }
    );
  }

  try {
    const stored = await getStorage().save(file);
    const brand = setBrand({ logoUrl: stored.url });
    return NextResponse.json({ brand });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo guardar el logotipo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
