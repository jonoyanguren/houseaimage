import type { Clip, ClipFailure, ProviderClipStatus } from "@/types/video";
import { hasTimedOut, isRetryDue, timeoutFailure } from "@/lib/engine/policy";

/**
 * The single place that decides what happens to a clip next.
 *
 * Before this existed, transitions were scattered across job submission,
 * polling, the timeout check and the retry branch, and no one function knew
 * the whole set. Both defects the audit turned up lived in that gap. Now the
 * decision is one pure function of (clip, provider reading, clock) and the
 * orchestration in `pipeline.ts` only carries it out.
 */

export type ClipTransition =
  /** Store the clip as-is; nothing further to do this round. */
  | { type: "keep"; clip: Clip }
  /** Store the clip, then re-submit it to the provider. */
  | { type: "resubmit"; clip: Clip };

/**
 * A status call that threw. This is a transient network problem, not a failed
 * render: the job is very likely still running, so the clip keeps its state
 * and the next poll retries the read. Recording it as a render failure would
 * spend an attempt on a clip that never actually failed.
 */
export function onPollError(clip: Clip, error: unknown, now: number): ClipTransition {
  const failure: ClipFailure = {
    kind: "network",
    message:
      error instanceof Error ? error.message : "No se pudo consultar el estado del clip",
    at: now,
  };

  // Note the problem for diagnostics without changing `status`.
  return { type: "keep", clip: { ...clip, failure } };
}

/**
 * Fold a provider reading into the clip, then decide whether it is due to be
 * re-submitted.
 */
export function nextClipState(
  clip: Clip,
  reading: ProviderClipStatus | undefined,
  now: number
): ClipTransition {
  let next = clip;

  if (reading) {
    next = {
      ...clip,
      status: reading.status,
      progress: reading.progress,
      videoUrl: reading.videoUrl,
      simulated: reading.simulated,
      // A reading that is not a failure clears any earlier one, so a clip that
      // recovers does not carry a stale error around.
      failure: reading.status === "failed" ? reading.failure : undefined,
    };
  }

  // A provider that never settles a job would otherwise keep the batch polling
  // until its TTL evicted it, and the user would be told it "expired".
  if (hasTimedOut(next, now)) {
    next = { ...next, status: "failed", failure: timeoutFailure(now) };
  }

  return isRetryDue(next, now) ? { type: "resubmit", clip: next } : { type: "keep", clip: next };
}

/**
 * Carry a clip's identity across a re-submission.
 *
 * `clipId` must survive: it is what the UI keys on, so a new one remounts the
 * tile and makes the reel flicker. `index` must survive too — it is the clip's
 * position in the finished video.
 */
export function adoptRetry(previous: Clip, submitted: Clip): Clip {
  return { ...submitted, clipId: previous.clipId, index: previous.index };
}
