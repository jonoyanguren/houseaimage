import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { StorageProvider, StoredImage } from "@/types/storage";

/**
 * Local filesystem storage, under `public/uploads` so photos are served at
 * `/uploads/<file>`.
 *
 * ⚠️ Only viable where the filesystem is writable and persistent — a VPS or a
 * long-lived container. On serverless targets the disk is read-only or
 * ephemeral, so uploads vanish between requests. Swap `STORAGE_DRIVER` for an
 * object store before deploying there.
 */

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

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
  // The assembled reel comes back through the same interface as the photos.
  if (subtype === "mp4") return "mp4";
  if (subtype === "webm") return "webm";

  return "jpg";
}

export const localStorageProvider: StorageProvider = {
  name: "local",

  async save(file: File): Promise<StoredImage> {
    await mkdir(UPLOAD_DIR, { recursive: true });

    // The name is ours, never the client's — no path traversal is possible.
    const key = `${randomUUID()}.${extensionFor(file.type)}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    await writeFile(path.join(UPLOAD_DIR, key), buffer);

    return { url: `/uploads/${key}`, key };
  },
};
