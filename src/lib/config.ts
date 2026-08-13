/**
 * Pipeline tunables, all overridable by environment variable.
 *
 * Defaults are chosen so the app runs with an empty `.env` — see
 * `src/lib/providers/index.ts`, which falls back to the simulated provider
 * when no API key is present.
 */

function intFromEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;

  return Math.min(Math.max(parsed, min), max);
}

/**
 * How many photos a single batch may contain. A listing with 60 photos would
 * mean 60 provider jobs and a reel nobody watches to the end, so we refuse
 * early with a clear error instead of burning credits.
 */
export const MAX_PHOTOS_PER_BATCH = intFromEnv("MAX_PHOTOS_PER_BATCH", 20, 1, 60);

/**
 * Provider jobs created in parallel during fan-out. Providers rate-limit per
 * account, and creating 20 jobs at once is the fastest way to get a 429 —
 * which would fail the whole batch rather than just slowing it down.
 */
export const CREATE_CONCURRENCY = intFromEnv("CREATE_CONCURRENCY", 4, 1, 16);

/** Status requests issued in parallel when refreshing a batch. */
export const POLL_CONCURRENCY = intFromEnv("POLL_CONCURRENCY", 6, 1, 16);

/**
 * Automatic re-submissions of a clip whose provider job failed. Image-to-video
 * jobs fail transiently often enough that one silent retry meaningfully raises
 * the share of batches that come out whole.
 */
export const MAX_CLIP_ATTEMPTS = intFromEnv("MAX_CLIP_ATTEMPTS", 2, 1, 5);

/**
 * Base wait before re-submitting a failed clip, doubling per attempt.
 *
 * Retrying instantly is worse than not retrying: the usual cause of a failure
 * is a rate limit or a provider wobble, and an immediate retry hits the same
 * wall and burns the remaining attempt for nothing.
 */
export const RETRY_BACKOFF_MS = intFromEnv("RETRY_BACKOFF_SECONDS", 15, 1, 600) * 1_000;

/**
 * How long a clip may sit unfinished before we give up on it.
 *
 * Without this a provider that never settles a job leaves the batch polling
 * forever, until the TTL quietly evicts it and the user is told the batch
 * "expired" — which is both wrong and unactionable.
 */
export const CLIP_TIMEOUT_MS = intFromEnv("CLIP_TIMEOUT_MINUTES", 10, 1, 120) * 60_000;

/** Assumed clip length when the provider doesn't tell us, used for timeline maths. */
export const DEFAULT_CLIP_SECONDS = intFromEnv("DEFAULT_CLIP_SECONDS", 5, 2, 15);

/** Batches older than this are dropped from the in-memory store. */
export const BATCH_TTL_MS = intFromEnv("BATCH_TTL_MINUTES", 60, 5, 1440) * 60_000;
