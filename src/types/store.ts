import type { Batch } from "@/types/video";

/**
 * Somewhere to keep batches between requests.
 *
 * A batch outlives the request that created it: fan-out returns immediately
 * and the client then polls for minutes. Something has to remember which
 * provider job ids belong to which batch, and in what order.
 *
 * Every method is async even though the in-memory implementation has no need
 * to be. Redis, Postgres and KV all are, so committing to async now means
 * swapping the backend later is a one-module change instead of a change that
 * ripples through every caller.
 */
export interface BatchStore {
  readonly name: string;
  save(batch: Batch): Promise<Batch>;
  get(batchId: string): Promise<Batch | undefined>;
  delete(batchId: string): Promise<void>;
}
