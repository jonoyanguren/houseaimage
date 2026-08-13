import type { Batch } from "@/types/video";
import { BATCH_TTL_MS } from "@/lib/config";

/**
 * In-memory batch store.
 *
 * A batch has to outlive the request that created it: fan-out returns
 * immediately and the client then polls for minutes. Something has to remember
 * which provider job ids belong to which batch, and in what order.
 *
 * ⚠️ This implementation is per-process and non-persistent. It is fine for
 * local development and a single long-lived server, and **wrong** for
 * serverless or multi-instance deployments, where consecutive polls may hit
 * different instances and 404. Swap the four functions below for Redis,
 * Postgres or KV before deploying — callers only use this module's surface, so
 * that stays a one-file change.
 *
 * Held on `globalThis` so a dev-server hot reload doesn't orphan running
 * batches.
 */

const globalForStore = globalThis as unknown as {
  __houseaimageBatches?: Map<string, Batch>;
};

const batches: Map<string, Batch> =
  globalForStore.__houseaimageBatches ?? new Map<string, Batch>();

globalForStore.__houseaimageBatches = batches;

/** Drop batches past their TTL so a long-running dev server doesn't grow forever. */
function evictExpired(now: number) {
  for (const [batchId, batch] of batches) {
    if (now - batch.updatedAt > BATCH_TTL_MS) batches.delete(batchId);
  }
}

export function saveBatch(batch: Batch): Batch {
  evictExpired(Date.now());
  batches.set(batch.batchId, batch);
  return batch;
}

export function getBatch(batchId: string): Batch | undefined {
  const batch = batches.get(batchId);
  if (!batch) return undefined;

  if (Date.now() - batch.updatedAt > BATCH_TTL_MS) {
    batches.delete(batchId);
    return undefined;
  }

  return batch;
}

/**
 * Replace a batch, stamping `updatedAt`. Callers build the next batch value
 * themselves rather than mutating in place, which keeps the stored object safe
 * to hand straight to `NextResponse.json`.
 */
export function updateBatch(batch: Batch): Batch {
  return saveBatch({ ...batch, updatedAt: Date.now() });
}

export function deleteBatch(batchId: string): void {
  batches.delete(batchId);
}
