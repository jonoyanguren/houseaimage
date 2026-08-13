import type { Batch } from "@/types/video";
import type { BatchStore } from "@/types/store";
import { BATCH_TTL_MS } from "@/lib/config";

/**
 * In-memory batch store.
 *
 * ⚠️ Per-process and non-persistent. Fine for local development and a single
 * long-lived server; wrong for serverless or multi-instance deployments, where
 * consecutive polls may hit different instances and 404.
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

export const memoryBatchStore: BatchStore = {
  name: "memory",

  async save(batch: Batch): Promise<Batch> {
    evictExpired(Date.now());
    batches.set(batch.batchId, batch);
    return batch;
  },

  async get(batchId: string): Promise<Batch | undefined> {
    const batch = batches.get(batchId);
    if (!batch) return undefined;

    if (Date.now() - batch.updatedAt > BATCH_TTL_MS) {
      batches.delete(batchId);
      return undefined;
    }

    return batch;
  },

  async delete(batchId: string): Promise<void> {
    batches.delete(batchId);
  },
};

/** Test seam: drop everything. Not part of the `BatchStore` contract. */
export function __clearMemoryStore() {
  batches.clear();
}
