import type { Clip, ClipFailure, FailureKind } from "@/types/video";
import {
  CLIP_TIMEOUT_MS,
  MAX_CLIP_ATTEMPTS,
  RETRY_BACKOFF_MS,
} from "@/lib/config";

/**
 * Retry policy — the engine's answers to "is this worth trying again, and
 * when?", kept apart from the orchestration that carries it out.
 *
 * Separating them matters because these are the rules that cost money. They
 * are pure functions of a clip, so they can be reasoned about and tested
 * without a provider, a store or a clock.
 */

/**
 * Failures that will never succeed no matter how many times we pay for them.
 *
 * A photo the provider rejects as an unsupported format is rejected just as
 * hard on the second attempt; retrying it only doubles the bill. Anything
 * unrecognised is treated as transient, because wrongly giving up on a
 * recoverable clip is worse than one wasted retry.
 */
const PERMANENT: ReadonlySet<FailureKind> = new Set<FailureKind>([
  "invalid_input",
  "unauthorized",
]);

export function isPermanent(kind: FailureKind): boolean {
  return PERMANENT.has(kind);
}

/**
 * Rate limits need materially more room than a random 500 — coming back after
 * fifteen seconds walks into the same wall.
 */
const BACKOFF_MULTIPLIER: Partial<Record<FailureKind, number>> = {
  rate_limited: 4,
};

/** How long to wait before attempt N, doubling each time. */
export function backoffFor(clip: Clip): number {
  const multiplier = clip.failure ? (BACKOFF_MULTIPLIER[clip.failure.kind] ?? 1) : 1;
  return RETRY_BACKOFF_MS * 2 ** (clip.attempts - 1) * multiplier;
}

/** True when the engine will re-submit this clip on its own, eventually. */
export function willRetry(clip: Clip): boolean {
  if (clip.status !== "failed") return false;
  if (clip.attempts >= MAX_CLIP_ATTEMPTS) return false;
  if (clip.failure && isPermanent(clip.failure.kind)) return false;
  return true;
}

/** True when that retry is due now, rather than still inside its backoff. */
export function isRetryDue(clip: Clip, now: number): boolean {
  return willRetry(clip) && now - clip.submittedAt >= backoffFor(clip);
}

/** True once the clip can no longer change state on its own. */
export function isSettled(clip: Clip): boolean {
  if (clip.status === "completed") return true;
  return clip.status === "failed" && !willRetry(clip);
}

/** True when a running clip has been running for longer than we allow. */
export function hasTimedOut(clip: Clip, now: number): boolean {
  if (clip.status === "completed" || clip.status === "failed") return false;
  return now - clip.submittedAt > CLIP_TIMEOUT_MS;
}

export function timeoutFailure(now: number): ClipFailure {
  return {
    kind: "timeout",
    message: `El proveedor no terminó este clip en ${Math.round(
      CLIP_TIMEOUT_MS / 60_000
    )} minutos`,
    at: now,
  };
}
