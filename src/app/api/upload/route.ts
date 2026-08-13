import { NextRequest, NextResponse } from "next/server";
import { getStorage, toAbsoluteUrl } from "@/lib/storage";
import { MAX_PHOTOS_PER_BATCH } from "@/lib/config";

/** Reject oversized originals before writing them to disk. */
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  if (files.length > MAX_PHOTOS_PER_BATCH) {
    return NextResponse.json(
      {
        error: `Too many photos: ${files.length}. The limit is ${MAX_PHOTOS_PER_BATCH}.`,
      },
      { status: 400 }
    );
  }

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: `"${file.name}" is not an image` },
        { status: 400 }
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `"${file.name}" is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB` },
        { status: 413 }
      );
    }
  }

  // The provider fetches these URLs itself, so they must be absolute and
  // publicly reachable — a localhost URL works in dev only because the
  // simulated provider never downloads anything.
  const origin = req.nextUrl.origin;
  const storage = getStorage();

  try {
    const urls = await Promise.all(
      files.map(async (file) => {
        const stored = await storage.save(file);
        return toAbsoluteUrl(stored.url, origin);
      })
    );
    return NextResponse.json({ urls });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
