import type {
  Batch,
  Clip,
  ClipOptions,
  PhotoInput,
  ProviderClipStatus,
  VideoProvider,
} from "@/types/video";
import { getVideoProvider, toClipFailure } from "@/lib/providers";
import { mapWithConcurrency } from "@/lib/concurrency";
import { withDerivedState } from "@/lib/compose";
import { isSettled } from "@/lib/engine/state";
import { adoptRetry, nextClipState, onPollError } from "@/lib/engine/transitions";
import { getBatch, saveBatch, updateBatch } from "@/lib/jobStore";
import { withLock } from "@/lib/lock";
import { maybeStartStitching } from "@/lib/engine/stitching";
import { buildClipPrompt, isSceneType } from "@/lib/prompts";
import {
  CREATE_CONCURRENCY,
  MAX_PHOTOS_PER_BATCH,
  POLL_CONCURRENCY,
} from "@/lib/config";

/**
 * The generation pipeline.
 *
 * One photo is one provider job. `createBatch` fans out, `refreshBatch` polls
 * every unsettled job and retries the ones that failed, and `src/lib/compose`
 * assembles whatever survived into a reel.
 *
 * The invariant everything else depends on: a clip's `index` is its position
 * in the user's photo order and never changes, no matter what order the
 * provider finishes the jobs in.
 */

export class ValidationError extends Error {}

function validate(photos: PhotoInput[]) {
  if (!Array.isArray(photos) || photos.length === 0) {
    throw new ValidationError("photos is required and must not be empty");
  }

  if (photos.length > MAX_PHOTOS_PER_BATCH) {
    throw new ValidationError(
      `Too many photos: ${photos.length}. The limit is ${MAX_PHOTOS_PER_BATCH} ` +
        "(each photo becomes its own provider job)."
    );
  }

  for (const photo of photos) {
    if (typeof photo?.imageUrl !== "string" || !/^https?:\/\//i.test(photo.imageUrl)) {
      throw new ValidationError(
        `Not a usable image URL: ${String(photo?.imageUrl)}`
      );
    }
    // An unknown scene is not worth rejecting the batch over — the resolver
    // falls back to neutral motion — but a malformed one signals a client bug.
    if (photo.sceneType !== undefined && !isSceneType(photo.sceneType)) {
      throw new ValidationError(`Unknown scene type: ${String(photo.sceneType)}`);
    }
  }
}

/**
 * Submit one photo, turning a provider rejection into a failed clip.
 *
 * The prompt is resolved here rather than inside the provider: every backend
 * gets the same words, and the resolved text is stored on the clip so a retry
 * reproduces exactly what was asked for the first time.
 */
async function submitClip(
  provider: VideoProvider,
  photo: PhotoInput,
  index: number,
  options: ClipOptions | undefined,
  attempts: number
): Promise<Clip> {
  const clipId = crypto.randomUUID();
  const resolved = buildClipPrompt({
    styleId: options?.styleId,
    propertyType: options?.propertyType,
    sceneType: photo.sceneType,
    extra: options?.prompt,
  });

  const now = Date.now();
  const base = {
    clipId,
    index,
    imageUrl: photo.imageUrl,
    sceneType: resolved.sceneType,
    resolved,
    attempts,
    submittedAt: now,
  };

  try {
    const job = await provider.createClipJob({
      imageUrl: photo.imageUrl,
      resolved,
      options,
    });
    return { ...base, providerJobId: job.providerJobId, status: job.status };
  } catch (err) {
    // One photo failing to enqueue must not sink the other nine. The provider
    // classifies its own errors, so a permanently bad photo is not retried.
    return {
      ...base,
      providerJobId: "",
      status: "failed",
      failure: toClipFailure(err, now),
    };
  }
}

/** Fan out: N photos become N provider jobs, throttled and order-preserving. */
export async function createBatch(
  photos: PhotoInput[],
  options?: ClipOptions
): Promise<Batch> {
  validate(photos);

  const provider = getVideoProvider();
  const now = Date.now();

  const clips = await mapWithConcurrency(
    photos,
    CREATE_CONCURRENCY,
    (photo, index) => submitClip(provider, photo, index, options, 1)
  );

  const batch: Batch = {
    batchId: crypto.randomUUID(),
    status: "processing",
    createdAt: now,
    updatedAt: now,
    options,
    clips,
  };

  return saveBatch(withDerivedState(batch, clips));
}

/**
 * Advance one clip: read the provider, ask `transitions` what that means, and
 * carry out whatever it decided.
 *
 * All the judgement — timeouts, permanence, backoff — lives in
 * `engine/policy` and `engine/transitions`. This function only performs I/O.
 */
async function refreshClip(
  provider: VideoProvider,
  clip: Clip,
  options: ClipOptions | undefined
): Promise<Clip> {
  const now = Date.now();

  let reading: ProviderClipStatus | undefined;
  if (clip.providerJobId) {
    try {
      reading = await provider.getClipJobStatus(clip.providerJobId);
    } catch (err) {
      return onPollError(clip, err, now).clip;
    }
  }

  const decision = nextClipState(clip, reading, now);
  if (decision.type === "keep") return decision.clip;

  const submitted = await submitClip(
    provider,
    { imageUrl: decision.clip.imageUrl, sceneType: decision.clip.sceneType },
    decision.clip.index,
    options,
    decision.clip.attempts + 1
  );

  return adoptRetry(decision.clip, submitted);
}

/**
 * Refresh every unsettled clip in the batch and recompute its derived state.
 * Settled clips are skipped, so polling a finished batch costs nothing.
 */
export function refreshBatch(batchId: string): Promise<Batch | undefined> {
  // Serialised per batch, and — critically — the batch is re-read *inside* the
  // lock. Callers used to hand in a snapshot they had fetched earlier, so two
  // concurrent polls both saw the same failed clip and both re-submitted it.
  return withLock(batchId, async () => {
    const batch = await getBatch(batchId);
    if (!batch) return undefined;

    // Anything not settled: still running, or failed with an attempt left.
    // Completed clips are never re-polled.
    const pending = batch.clips.filter((clip) => !isSettled(clip));
    // Already finished rendering, but the downloadable file may still be due —
    // a batch that settled before stitching existed, or a poll that lost the
    // race with the one that finished it.
    if (pending.length === 0) {
      const { batch: marked, start } = await maybeStartStitching(batch);
      const saved = await updateBatch(marked);
      // Only after the save: the background job reads the store.
      start?.();
      return saved;
    }

    const provider = getVideoProvider();

    const refreshed = await mapWithConcurrency(pending, POLL_CONCURRENCY, (clip) =>
      refreshClip(provider, clip, batch.options)
    );

    const byClipId = new Map(refreshed.map((clip) => [clip.clipId, clip]));
    const clips = batch.clips.map((clip) => byClipId.get(clip.clipId) ?? clip);

    const next = withDerivedState(batch, clips);
    const { batch: marked, start } = await maybeStartStitching(next);
    const saved = await updateBatch(marked);
    start?.();
    return saved;
  });
}

/**
 * Re-render one clip, whatever state it is in.
 *
 * This is not a retry: the user is saying "this shot is wrong", not the engine
 * recovering from an error. So a `completed` clip is fair game, and the cost is
 * explicit — one job, on demand.
 *
 * Re-rendering changes the footage, which invalidates any assembled file.
 * Nothing here has to handle that: `withDerivedState` compares the footage and
 * drops a stale download by itself, and the next poll starts a fresh encode.
 */
export function regenerateClip(
  batchId: string,
  clipId: string
): Promise<Batch | undefined> {
  // Same lock as polling, or a regenerate landing mid-poll would let both
  // submit a job for the same slot.
  return withLock(batchId, async () => {
    const batch = await getBatch(batchId);
    if (!batch) return undefined;

    const target = batch.clips.find((clip) => clip.clipId === clipId);
    if (!target) throw new ValidationError(`Unknown clip: ${clipId}`);

    const provider = getVideoProvider();
    const submitted = await submitClip(
      provider,
      { imageUrl: target.imageUrl, sceneType: target.sceneType },
      target.index,
      batch.options,
      1
    );

    // `adoptRetry` is what keeps `clipId` and `index` — the UI keys on the
    // first and the finished video is ordered by the second.
    const next = adoptRetry(target, submitted);
    const clips = batch.clips.map((clip) => (clip.clipId === clipId ? next : clip));

    return updateBatch(withDerivedState(batch, clips));
  });
}

/**
 * Re-submit the clips that ended up failed, resetting their attempt counter.
 * Used by the "retry failed clips" action once automatic retries ran out.
 */
export function retryFailedClips(batchId: string): Promise<Batch | undefined> {
  // Shares the batch lock with `refreshBatch`, so a manual retry crossing a
  // poll cannot double-submit the same clip either.
  return withLock(batchId, async () => {
    const batch = await getBatch(batchId);
    if (!batch) return undefined;

    const failed = batch.clips.filter((clip) => clip.status === "failed");
    if (failed.length === 0) return batch;

    const provider = getVideoProvider();

    const resubmitted = await mapWithConcurrency(failed, CREATE_CONCURRENCY, (clip) =>
      submitClip(
        provider,
        { imageUrl: clip.imageUrl, sceneType: clip.sceneType },
        clip.index,
        batch.options,
        1
      ).then((next) => ({ ...next, clipId: clip.clipId }))
    );

    const byClipId = new Map(resubmitted.map((clip) => [clip.clipId, clip]));
    const clips = batch.clips.map((clip) => byClipId.get(clip.clipId) ?? clip);

    return updateBatch(withDerivedState(batch, clips));
  });
}
