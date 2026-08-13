import type { StorageProvider } from "@/types/storage";
import { localStorageProvider } from "@/lib/storage/local";

/**
 * Storage selection.
 *
 * Photos have to outlive the request that uploaded them, and the video
 * provider fetches them over HTTP by itself — so wherever they land has to be
 * publicly reachable. That rules out the local filesystem for any serverless
 * or multi-instance deployment, which is why this sits behind an interface.
 *
 * Adding a backend (S3, Cloudinary, Vercel Blob, Supabase Storage) means
 * writing one module and registering it here. Nothing else in the codebase
 * knows where a photo is stored.
 *
 * Resolution order mirrors `src/lib/providers`: an explicit `STORAGE_DRIVER`
 * always wins, otherwise we fall back to local disk so a fresh clone runs with
 * no configuration.
 */

const DRIVERS: Record<string, StorageProvider> = {
  local: localStorageProvider,
};

export function getStorage(): StorageProvider {
  const requested = process.env.STORAGE_DRIVER?.trim().toLowerCase();

  if (requested) {
    const driver = DRIVERS[requested];
    if (!driver) {
      throw new Error(
        `Unknown STORAGE_DRIVER "${requested}". Available: ${Object.keys(DRIVERS).join(", ")}`
      );
    }
    return driver;
  }

  return localStorageProvider;
}

/**
 * Make a stored URL absolute.
 *
 * Local storage returns a site-relative path; remote object stores return a
 * full URL already. The video provider downloads these itself, so what leaves
 * the API must always be absolute.
 */
export function toAbsoluteUrl(url: string, origin: string): string {
  return url.startsWith("/") ? `${origin}${url}` : url;
}
