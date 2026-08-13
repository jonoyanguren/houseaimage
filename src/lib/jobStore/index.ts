import type { Batch } from "@/types/video";
import type { BatchStore } from "@/types/store";
import { memoryBatchStore } from "@/lib/jobStore/memory";

/**
 * Batch store selection.
 *
 * Resolution mirrors `src/lib/providers` and `src/lib/storage`: an explicit
 * `BATCH_STORE` wins, otherwise in-memory, so a fresh clone runs unconfigured.
 *
 * To add Redis or Postgres, implement `BatchStore` and register it below.
 * Nothing outside this directory knows where batches live.
 */

const STORES: Record<string, BatchStore> = {
  memory: memoryBatchStore,
};

export function getBatchStore(): BatchStore {
  const requested = process.env.BATCH_STORE?.trim().toLowerCase();

  if (requested) {
    const store = STORES[requested];
    if (!store) {
      throw new Error(
        `Unknown BATCH_STORE "${requested}". Available: ${Object.keys(STORES).join(", ")}`
      );
    }
    return store;
  }

  return memoryBatchStore;
}

export function saveBatch(batch: Batch): Promise<Batch> {
  return getBatchStore().save(batch);
}

export function getBatch(batchId: string): Promise<Batch | undefined> {
  return getBatchStore().get(batchId);
}

/**
 * Replace a batch, stamping `updatedAt`. Callers build the next batch value
 * themselves rather than mutating in place, which keeps the stored object safe
 * to hand straight to `NextResponse.json`.
 */
export function updateBatch(batch: Batch): Promise<Batch> {
  return getBatchStore().save({ ...batch, updatedAt: Date.now() });
}

export function deleteBatch(batchId: string): Promise<void> {
  return getBatchStore().delete(batchId);
}
