import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Local filesystem storage for uploaded photos, saved under /public/uploads
 * so they're reachable at /uploads/<file> for local development.
 *
 * This works only on platforms with a writable, persistent filesystem.
 * Serverless targets (Vercel, etc.) have a read-only/ephemeral filesystem —
 * swap this out for a real object store (S3, Cloudinary, Vercel Blob) before
 * deploying to production. Keep the `saveImage` signature so callers don't
 * need to change.
 */

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

export async function saveImage(file: File): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });

  const ext = file.type.split("/")[1] ?? "jpg";
  const filename = `${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await writeFile(path.join(UPLOAD_DIR, filename), buffer);

  return `/uploads/${filename}`;
}
