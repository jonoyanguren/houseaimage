import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { StorageProvider, StoredImage } from "@/types/storage";

/**
 * Local filesystem storage, served back through `/api/uploads/<key>`.
 *
 * It used to write into `public/uploads`, which works in development and
 * **silently fails in production**: Next captures `public/` at build time, so
 * a photograph written there afterwards exists on disk and returns 404 over
 * HTTP. Every clip in a deployed batch failed on a photo the server could see
 * perfectly well — the kind of fault that only appears once you ship.
 *
 * So the files live outside `public/` now and a route hands them out. That
 * costs one route and removes a whole class of "works on my machine".
 *
 * ⚠️ Still only viable where the filesystem is writable and persistent — a VPS
 * or a long-lived container. On serverless the disk is read-only or ephemeral
 * and uploads vanish between requests: swap `STORAGE_DRIVER` for an object
 * store before deploying there.
 */

/**
 * Outside `public/` on purpose, and outside the repository's tracked files.
 *
 * Overridable so a deployment can point it at a mounted volume — and so the
 * tests stop dropping one-byte files into the directory a running app is
 * serving from, which is how they were found.
 */
const UPLOAD_DIR =
  process.env.STORAGE_LOCAL_DIR?.trim() || path.join(process.cwd(), ".uploads");

/** The route that serves them back. Kept here so both halves agree. */
export const UPLOAD_ROUTE = "/api/uploads";

/**
 * Keys we are willing to read back: exactly what `save` generates.
 *
 * A UUID and a known extension, anchored at both ends. The route validates
 * against this before touching the disk, so a crafted key cannot walk out of
 * the directory.
 */
export const UPLOAD_KEY = /^[0-9a-f-]{36}\.(jpg|png|webp|avif|heic|svg|mp4|webm)$/i;

/**
 * Derive a file extension from the MIME type rather than the client-supplied
 * filename, which is attacker-controlled and could carry a path or a second
 * extension.
 */
function extensionFor(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.toLowerCase() ?? "";

  if (subtype === "jpeg" || subtype === "jpg") return "jpg";
  if (subtype === "png") return "png";
  if (subtype === "webp") return "webp";
  if (subtype === "avif") return "avif";
  if (subtype === "heic" || subtype === "heif") return "heic";
  // The agency logo comes through here too, and an SVG saved as .jpg is a
  // broken image on the closing card.
  if (subtype === "svg+xml") return "svg";
  // The assembled reel comes back through the same interface as the photos.
  if (subtype === "mp4") return "mp4";
  if (subtype === "webm") return "webm";

  return "jpg";
}

/** What to serve a stored key back as. */
export function mimeFor(key: string): string {
  const extension = key.split(".").pop()?.toLowerCase();

  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "avif") return "image/avif";
  if (extension === "heic") return "image/heic";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "mp4") return "video/mp4";
  if (extension === "webm") return "video/webm";

  return "image/jpeg";
}

/** Absolute path of a stored key, once the key has been validated. */
export function pathFor(key: string): string {
  return path.join(UPLOAD_DIR, key);
}

export const localStorageProvider: StorageProvider = {
  name: "local",

  async save(file: File): Promise<StoredImage> {
    await mkdir(UPLOAD_DIR, { recursive: true });

    // The name is ours, never the client's — no path traversal is possible.
    const key = `${randomUUID()}.${extensionFor(file.type)}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    await writeFile(path.join(UPLOAD_DIR, key), buffer);

    return { url: `${UPLOAD_ROUTE}/${key}`, key };
  },
};
