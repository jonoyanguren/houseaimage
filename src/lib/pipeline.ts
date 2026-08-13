import type { Batch, Clip, ClipOptions, VideoProvider } from "@/types/video";
import { getVideoProvider } from "@/lib/providers";
import { mapWithConcurrency } from "@/lib/concurrency";
import { isSettled, withDerivedState } from "@/lib/compose";
import { saveBatch, updateBatch } from "@/lib/jobStore";
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

function validate(imageUrls: string[]) {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    throw new ValidationError("imageUrls is required and must not be empty");
  }

  if (imageUrls.length > MAX_PHOTOS_PER_BATCH) {
    throw new ValidationError(
      `Too many photos: ${imageUrls.length}. The limit is ${MAX_PHOTOS_PER_BATCH} ` +
        "(each photo becomes its own provider job)."
    );
  }

  for (const url of imageUrls) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      throw new ValidationError(`Not a usable image URL: ${String(url)}`);
    }
  }
}

/** Submit one photo, turning a provider rejection into a failed clip. */
async function submitClip(
  provider: VideoProvider,
  imageUrl: string,
  index: number,
  options: ClipOptions | undefined,
  attempts: number
): Promise<Clip> {
  const clipId = crypto.randomUUID();

  try {
    const job = await provider.createClipJob({ imageUrl, options });
    return {
      clipId,
      index,
      imageUrl,
      providerJobId: job.providerJobId,
      status: job.status,
      attempts,
    };
  } catch (err) {
    // One photo failing to enqueue must not sink the other nine.
    return {
      clipId,
      index,
      imageUrl,
      providerJobId: "",
      status: "failed",
      error: err instanceof Error ? err.message : "Could not create the provider job",
      attempts,
    };
  }
}

/** Fan out: N photos become N provider jobs, throttled and order-preserving. */
export async function createBatch(
  imageUrls: string[],
  options?: ClipOptions
): Promise<Batch> {
  validate(imageUrls);

  const provider = getVideoProvider();
  const now = Date.now();

  const clips = await mapWithConcurrency(
    imageUrls,
    CREATE_CONCURRENCY,
    (imageUrl, index) => submitClip(provider, imageUrl, index, options, 1)
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
      next.imageUrl,
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
    submitClip(provider, clip.imageUrl, clip.index, batch.options, 1).then((next) => ({
      ...next,
      clipId: clip.clipId,
    }))
  );

  const byClipId = new Map(resubmitted.map((clip) => [clip.clipId, clip]));
  const clips = batch.clips.map((clip) => byClipId.get(clip.clipId) ?? clip);

  return updateBatch(withDerivedState(batch, clips));
}
