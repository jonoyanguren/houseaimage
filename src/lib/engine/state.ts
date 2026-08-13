import type { BatchStatus, Clip } from "@/types/video";
import { isSettled, willRetry } from "@/lib/engine/policy";

/**
 * Batch-level state, derived from its clips.
 *
 * This is engine state, not output. Assembling the actual reel lives in
 * `src/lib/compose.ts`; the two were in one module and it blurred the line
 * between "what is the batch doing" and "what does the user get".
 */

/** A clip that actually contributes footage to the reel. */
export function isUsable(clip: Clip): boolean {
  // Simulated clips have no videoUrl by design but still occupy a slot in the
  // timeline, so the montage can be demoed without credentials.
  return clip.status === "completed" && (Boolean(clip.videoUrl) || Boolean(clip.simulated));
}

/**
 * Derive batch status from its clips. The single source of truth — never
 * compute this inline somewhere else.
 *
 * `partial` matters: a listing with one failed photo should still produce a
 * reel from the other nine rather than throwing the batch away.
 */
export function deriveBatchStatus(clips: Clip[]): BatchStatus {
  if (clips.length === 0) return "failed";
  if (!clips.every(isSettled)) return "processing";

  const usable = clips.filter(isUsable).length;
  if (usable === 0) return "failed";
  if (usable === clips.length) return "completed";

  return "partial";
}

export { isSettled, willRetry };
