import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { UPLOAD_KEY, mimeFor, pathFor } from "@/lib/storage/local";

/**
 * Serve a stored photograph back.
 *
 * This route exists because `public/` is captured at build time: a file
 * written there after the build is on disk and invisible over HTTP, so every
 * deployed batch failed on photos the server could read perfectly well. Files
 * live outside `public/` now and come back through here.
 *
 * Deliberately outside the access gate. The engine reads these with no cookie
 * to present — it is the server fetching its own URL — and gating them would
 * break exactly the flow this route was written to fix. The keys are random
 * UUIDs, which is the same protection a signed object-store URL gives, minus
 * the expiry. That expiry is the reason to move to a real object store.
 */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/uploads/[key]">
) {
  const { key } = await ctx.params;

  // Validated before touching the disk: only what `save` generates gets read,
  // so a crafted key cannot walk out of the directory.
  if (!UPLOAD_KEY.test(key)) {
    return NextResponse.json({ error: "Nombre no válido" }, { status: 400 });
  }

  try {
    const bytes = await readFile(pathFor(key));

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeFor(key),
        // The name is a random UUID and the bytes never change under it, so
        // this can be cached hard. It is fetched once per clip by the engine
        // and again by every viewer of the reel.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }
}
