import type { Batch, Clip, ClipOptions, Reel, ReelSegment } from "@/types/video";
import { deriveBatchStatus, isSettled, isUsable } from "@/lib/engine/state";
import { DEFAULT_CLIP_SECONDS } from "@/lib/config";
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
