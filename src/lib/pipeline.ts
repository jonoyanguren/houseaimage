import type {
  Batch,
  Clip,
  ClipOptions,
  PhotoInput,
  VideoProvider,
} from "@/types/video";
import { getVideoProvider } from "@/lib/providers";
import { mapWithConcurrency } from "@/lib/concurrency";
import { isSettled, withDerivedState } from "@/lib/compose";
import { saveBatch, updateBatch } from "@/lib/jobStore";
import { buildClipPrompt, isSceneType } from "@/lib/prompts";
import {
  CREATE_CONCURRENCY,
  MAX_CLIP_ATTEMPTS,
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
  const resolved = buildClipPrompt(
    options?.styleId,
    photo.sceneType,
    options?.prompt
  );

  const base = {
    clipId,
    index,
    imageUrl: photo.imageUrl,
    sceneType: resolved.sceneType,
    attempts,
  };

  try {
    const job = await provider.createClipJob({
      imageUrl: photo.imageUrl,
      resolved,
      options,
    });
    return { ...base, providerJobId: job.providerJobId, status: job.status };
  } catch (err) {
    // One photo failing to enqueue must not sink the other nine.
    return {
      ...base,
      providerJobId: "",
      status: "failed",
      error: err instanceof Error ? err.message : "Could not create the provider job",
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

/** Poll one clip and, if it failed and has attempts left, re-submit it. */
async function refreshClip(
  provider: VideoProvider,
  clip: Clip,
  options: ClipOptions | undefined
): Promise<Clip> {
  let next = clip;

  if (clip.providerJobId) {
    try {
      const status = await provider.getClipJobStatus(clip.providerJobId);
      next = {
        ...clip,
        status: status.status,
        progress: status.progress,
        videoUrl: status.videoUrl,
        error: status.error,
        simulated: status.simulated,
      };
    } catch (err) {
      // A failed status call is a transient network problem, not a failed
      // render — leave the clip as it was so the next poll can recover.
      return {
        ...clip,
        error: err instanceof Error ? err.message : "Could not read the job status",
      };
    }
  }

  if (next.status === "failed" && next.attempts < MAX_CLIP_ATTEMPTS) {
    const retried = await submitClip(
      provider,
      { imageUrl: next.imageUrl, sceneType: next.sceneType },
      next.index,
      options,
      next.attempts + 1
    );
    // Keep the clip's identity across retries so the UI doesn't remount it.
    return { ...retried, clipId: next.clipId };
  }

  return next;
}

/**
 * Refresh every unsettled clip in the batch and recompute its derived state.
 * Settled clips are skipped, so polling a finished batch costs nothing.
 */
export async function refreshBatch(batch: Batch): Promise<Batch> {
  // Still running, or failed with an automatic retry left. Completed clips are
  // never re-polled.
  const pending = batch.clips.filter(
    (clip) =>
      !isSettled(clip) ||
      (clip.status === "failed" && clip.attempts < MAX_CLIP_ATTEMPTS)
  );

  if (pending.length === 0) return batch;

  const provider = getVideoProvider();

  const refreshed = await mapWithConcurrency(pending, POLL_CONCURRENCY, (clip) =>
    refreshClip(provider, clip, batch.options)
  );

  const byClipId = new Map(refreshed.map((clip) => [clip.clipId, clip]));
  const clips = batch.clips.map((clip) => byClipId.get(clip.clipId) ?? clip);

  return updateBatch(withDerivedState(batch, clips));
}

/**
 * Re-submit the clips that ended up failed, resetting their attempt counter.
 * Used by the "retry failed clips" action once automatic retries ran out.
 */
export async function retryFailedClips(batch: Batch): Promise<Batch> {
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
}
