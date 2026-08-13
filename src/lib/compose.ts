import type {
  Batch,
  BatchStatus,
  Clip,
  ClipOptions,
  Reel,
  ReelSegment,
} from "@/types/video";
import { DEFAULT_CLIP_SECONDS, MAX_CLIP_ATTEMPTS } from "@/lib/config";
import { getStyle } from "@/lib/prompts";

/**
 * Montage — turning N finished clips back into one video.
 *
 * The default strategy is `sequential-playlist`: we return an ordered timeline
 * and the client plays the clips back to back. It needs no extra
 * infrastructure and gives the user something watchable the moment the last
 * clip lands.
 *
 * A real downloadable single file needs actual concatenation — ffmpeg on a
 * worker, or a rendering service (Shotstack, Creatomate, Mux). That belongs
 * behind `stitchStrategy` below: implement it, return a `Reel` with `url` set
 * and `strategy: "server-side-stitch"`, and the client will offer the file
 * instead of the playlist. Nothing else needs to change.
 */

/**
 * True once the clip can no longer change state.
 *
 * A failed clip is **not** settled while it still has automatic attempts left:
 * the next poll will re-submit it. Treating `failed` alone as terminal made a
 * batch announce itself dead with a retry still pending — if the provider
 * rejected every photo at once (a rate limit, a brief outage), the whole batch
 * reported `failed` on creation and any client that trusted that status gave
 * up on work that was about to recover.
 */
export function isSettled(clip: Clip): boolean {
  if (clip.status === "completed") return true;
  return clip.status === "failed" && clip.attempts >= MAX_CLIP_ATTEMPTS;
}

/** True while the clip is waiting to be re-submitted after a failure. */
export function isAwaitingRetry(clip: Clip): boolean {
  return clip.status === "failed" && clip.attempts < MAX_CLIP_ATTEMPTS;
}

/** A clip that actually contributes footage to the reel. */
function isUsable(clip: Clip): boolean {
  // Simulated clips have no videoUrl by design but still occupy a slot in the
  // timeline, so the montage can be demoed without credentials.
  return clip.status === "completed" && (Boolean(clip.videoUrl) || Boolean(clip.simulated));
}

/**
 * Derive batch status from its clips.
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

/**
 * Build the reel from whichever clips succeeded, in the user's chosen order.
 * Returns undefined while clips are still running or when none survived.
 */
export function composeReel(
  clips: Clip[],
  options?: ClipOptions
): Reel | undefined {
  if (!clips.every(isSettled)) return undefined;

  const usable = clips.filter(isUsable).sort((a, b) => a.index - b.index);
  if (usable.length === 0) return undefined;

  // Clip length comes from the chosen style unless explicitly overridden — a
  // dynamic social reel runs on 4s cuts, a cinematic one on 7s.
  const durationSeconds =
    options?.durationSeconds ??
    getStyle(options?.styleId).durationSeconds ??
    DEFAULT_CLIP_SECONDS;

  let cursor = 0;
  const segments: ReelSegment[] = usable.map((clip) => {
    const segment: ReelSegment = {
      clipId: clip.clipId,
      index: clip.index,
      imageUrl: clip.imageUrl,
      sceneType: clip.sceneType,
      videoUrl: clip.videoUrl,
      simulated: clip.simulated,
      durationSeconds,
      startAtSeconds: cursor,
    };
    cursor += durationSeconds;
    return segment;
  });

  return {
    strategy: "sequential-playlist",
    segments,
    totalDurationSeconds: cursor,
  };
}

/** Recompute the derived fields of a batch after its clips changed. */
export function withDerivedState(batch: Batch, clips: Clip[]): Batch {
  return {
    ...batch,
    clips,
    status: deriveBatchStatus(clips),
    reel: composeReel(clips, batch.options),
  };
}
