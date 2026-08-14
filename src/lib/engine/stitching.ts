import type { Batch } from "@/types/video";
import { getStitchProvider } from "@/lib/stitch";
import { getBatch, updateBatch } from "@/lib/jobStore";
import { withLock } from "@/lib/lock";
import { getStyle } from "@/lib/prompts";

/**
 * Assembling the downloadable file, once a batch has finished rendering.
 *
 * It runs in the background rather than inside the poll that triggers it:
 * re-encoding a dozen clips is minutes of CPU, and holding an HTTP request
 * open that long would time out in front of the user. The client keeps
 * polling and the `url` appears when it is ready.
 *
 * ⚠️ Background work only survives on a host that keeps the process alive
 * after a response. On serverless it will be killed mid-encode — there this
 * belongs in a queue and a worker, and the seam is `src/lib/stitch`.
 */

/**
 * Batches being assembled right now, so repeated polls do not start a second
 * encode of the same reel. Per-process, like the lock it complements.
 */
const globalForStitch = globalThis as unknown as {
  __houseaimageStitching?: Set<string>;
};

const inFlight: Set<string> =
  globalForStitch.__houseaimageStitching ?? new Set<string>();

globalForStitch.__houseaimageStitching = inFlight;

/** True when this batch is finished rendering and has a file worth making. */
function isReadyToStitch(batch: Batch): boolean {
  if (batch.status !== "completed" && batch.status !== "partial") return false;

  const reel = batch.reel;
  if (!reel) return false;
  if (reel.url || reel.stitching || reel.stitchError) return false;

  // Simulated clips have no footage, so there is nothing to encode.
  return reel.segments.some((segment) => Boolean(segment.videoUrl));
}

export interface StitchStart {
  /** The batch to save, marked as stitching when a run is due. */
  batch: Batch;
  /**
   * Begins the encode. Call it **after** the batch has been saved: starting
   * earlier means the background job reads the store before the caller has
   * written the reel to it, finds nothing, and gives up silently — leaving the
   * batch stuck on "assembling" for good.
   */
  start?: () => void;
}

/**
 * Decide whether the batch is due a downloadable file.
 *
 * Must be called while holding the batch lock.
 */
export async function maybeStartStitching(batch: Batch): Promise<StitchStart> {
  if (!isReadyToStitch(batch) || inFlight.has(batch.batchId)) return { batch };

  const provider = await getStitchProvider();
  // No backend here: keep the playlist and say nothing. The reel still plays.
  if (!provider) return { batch };

  const reel = batch.reel!;
  const aspectRatio =
    batch.options?.aspectRatio ?? getStyle(batch.options?.styleId).aspectRatio;

  inFlight.add(batch.batchId);

  return {
    batch: { ...batch, reel: { ...reel, stitching: true } },
    start: () => void runStitch(batch.batchId, reel, aspectRatio),
  };
}

/**
 * Do the encode, then write the result back under the batch lock.
 *
 * The reel is handed in rather than re-read, because the caller has only just
 * derived it. The *write-back* does re-read: minutes have passed by then and a
 * retry may have changed the batch underneath us.
 */
async function runStitch(
  batchId: string,
  reel: NonNullable<Batch["reel"]>,
  aspectRatio: string
): Promise<void> {
  try {
    const provider = await getStitchProvider();
    if (!provider) return;

    const result = await provider.stitch(reel, aspectRatio);

    await withLock(batchId, async () => {
      const current = await getBatch(batchId);
      if (!current?.reel) return;

      await updateBatch({
        ...current,
        reel: {
          ...current.reel,
          strategy: "server-side-stitch",
          url: result.url,
          stitching: false,
        },
      });
    });
  } catch (err) {
    // A failed encode costs the download, not the reel — the playlist still
    // plays, so this is recorded and the batch stays usable.
    await withLock(batchId, async () => {
      const current = await getBatch(batchId);
      if (!current?.reel) return;

      await updateBatch({
        ...current,
        reel: {
          ...current.reel,
          stitching: false,
          stitchError:
            err instanceof Error ? err.message : "No se pudo montar el vídeo final",
        },
      });
    }).catch(() => {});
  } finally {
    inFlight.delete(batchId);
  }
}
