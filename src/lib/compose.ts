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

/**
 * Two reels cover the same footage, so an already-assembled file is still
 * valid for the new one.
 *
 * Compared by the clips involved and the video each one produced — a retry
 * that replaces a clip changes the footage and must invalidate the download,
 * while an ordinary poll that changes nothing must not.
 */
function sameFootage(a: Reel, b: Reel): boolean {
  if (a.segments.length !== b.segments.length) return false;
  return a.segments.every((segment, i) => {
    const other = b.segments[i];
    return segment.clipId === other.clipId && segment.videoUrl === other.videoUrl;
  });
}

/**
 * Recompute the derived fields of a batch after its clips changed.
 *
 * The reel is rebuilt from scratch every time, which would throw away the
 * assembled MP4 on the very next poll — so the stitch fields are carried
 * across whenever the footage is unchanged.
 */
export function withDerivedState(batch: Batch, clips: Clip[]): Batch {
  const reel = composeReel(clips, batch.options);

  const carried =
    reel && batch.reel && sameFootage(reel, batch.reel)
      ? {
          ...reel,
          strategy: batch.reel.strategy,
          url: batch.reel.url,
          stitching: batch.reel.stitching,
          stitchError: batch.reel.stitchError,
        }
      : reel;

  return {
    ...batch,
    clips,
    status: deriveBatchStatus(clips),
    reel: carried,
  };
}
