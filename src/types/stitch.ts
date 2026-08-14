import type { Reel } from "@/types/video";

export interface StitchResult {
  /** Publicly reachable URL of the finished file. */
  url: string;
  /** Bytes, for showing a download size. */
  bytes: number;
}

/**
 * Something that turns N rendered clips into one downloadable video.
 *
 * This is the difference between a demo and a product: the playlist is
 * watchable in our page, but what an estate agent buys is a file they can send
 * on WhatsApp or upload to a portal.
 *
 * Implementations must be safe to run concurrently for different batches and
 * must never mutate the reel they are given.
 */
export interface StitchProvider {
  readonly name: string;
  /** False when the backend is not usable here — a missing binary, say. */
  isAvailable(): Promise<boolean>;
  stitch(reel: Reel, aspectRatio: string): Promise<StitchResult>;
}
