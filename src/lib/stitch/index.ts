import type { StitchProvider } from "@/types/stitch";
import { ffmpegStitchProvider } from "@/lib/stitch/ffmpeg";

/**
 * Stitching backend selection.
 *
 * Same pattern as providers, storage and jobStore: a module per backend and an
 * `index` that picks by environment variable, with a fallback that works
 * unconfigured.
 *
 * The fallback here is *no stitching at all* — the reel stays a playlist. That
 * is deliberate: ffmpeg is not present on every host, and a missing binary
 * must degrade to "no download button" rather than fail a batch the customer
 * has already paid to render.
 *
 * To use a rendering service instead (Shotstack, Creatomate, Mux), implement
 * `StitchProvider` and register it below.
 */

const DRIVERS: Record<string, StitchProvider> = {
  ffmpeg: ffmpegStitchProvider,
};

/** Cached so we don't shell out to `ffmpeg -version` on every batch. */
let availability: Promise<StitchProvider | null> | undefined;

async function resolve(): Promise<StitchProvider | null> {
  const requested = process.env.STITCH_DRIVER?.trim().toLowerCase();

  if (requested === "none") return null;

  if (requested) {
    const driver = DRIVERS[requested];
    if (!driver) {
      throw new Error(
        `Unknown STITCH_DRIVER "${requested}". Available: ${Object.keys(DRIVERS).join(", ")}, none`
      );
    }
    // An explicit choice is honoured even if it looks unavailable, so a
    // misconfigured host fails loudly instead of silently dropping the file.
    return driver;
  }

  return (await ffmpegStitchProvider.isAvailable()) ? ffmpegStitchProvider : null;
}

export function getStitchProvider(): Promise<StitchProvider | null> {
  availability ??= resolve();
  return availability;
}

/** Test seam: forget the cached probe. */
export function __resetStitchProvider() {
  availability = undefined;
}
