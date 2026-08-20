import { open, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { UPLOAD_KEY, mimeFor, pathFor } from "@/lib/storage/local";

/**
 * Serve a stored photograph or reel back.
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

/**
 * Most a single request may read.
 *
 * A browser asks for a video in pieces; this bounds what one piece costs in
 * memory, whatever it asks for.
 */
const MAX_SLICE = 8 * 1024 * 1024;

/** Parse a single-range header. Multi-range is legal and nobody sends it. */
function parseRange(
  header: string,
  size: number
): { start: number; end: number } | "unsatisfiable" | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;

  const [, rawStart, rawEnd] = match;

  // `bytes=-500` means the last 500 bytes, not "up to 500".
  if (rawStart === "") {
    const length = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(length) || length <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number.parseInt(rawStart, 10);
  if (!Number.isFinite(start) || start >= size) return "unsatisfiable";

  const end = rawEnd === "" ? size - 1 : Number.parseInt(rawEnd, 10);
  if (!Number.isFinite(end) || end < start) return "unsatisfiable";

  return { start, end: Math.min(end, size - 1) };
}

async function readSlice(file: string, start: number, length: number) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function GET(req: Request, ctx: RouteContext<"/api/uploads/[key]">) {
  const { key } = await ctx.params;

  // Validated before touching the disk: only what `save` generates gets read,
  // so a crafted key cannot walk out of the directory.
  if (!UPLOAD_KEY.test(key)) {
    return NextResponse.json({ error: "Nombre no válido" }, { status: 400 });
  }

  const file = pathFor(key);

  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }

  const contentType = mimeFor(key);
  // The name is a random UUID and the bytes never change under it, so this can
  // be cached hard. `Accept-Ranges` is what tells a video element it may ask
  // for pieces at all.
  const headers = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  const requested = req.headers.get("range");

  /*
   * Range support is not an optimisation here, it is what makes the video
   * play. A `<video>` asks for pieces; answering every one of them with the
   * whole file and a `200` leaves Safari refusing to play at all and everyone
   * else unable to seek. The reel was being produced correctly and never
   * reaching the screen.
   */
  if (requested) {
    const range = parseRange(requested, size);

    if (range === "unsatisfiable") {
      return new NextResponse(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
    }

    if (range) {
      const end = Math.min(range.end, range.start + MAX_SLICE - 1);
      const bytes = await readSlice(file, range.start, end - range.start + 1);

      return new NextResponse(new Uint8Array(bytes), {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${range.start}-${end}/${size}`,
          "Content-Length": String(bytes.byteLength),
        },
      });
    }
  }

  const bytes = await readSlice(file, 0, Math.min(size, MAX_SLICE));

  return new NextResponse(new Uint8Array(bytes), {
    headers: { ...headers, "Content-Length": String(bytes.byteLength) },
  });
}
