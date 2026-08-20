import type { Batch } from "@/types/video";
import type { BatchStore } from "@/types/store";
import { BATCH_TTL_MS } from "@/lib/config";
import { getDb } from "@/lib/db";

/**
 * Batches that survive a restart.
 *
 * The in-memory store was always documented as development-only, and the cost
 * of leaving it was paid in public: reloading the page lost a reel that had
 * just been rendered and paid for, and every restart threw away the work in
 * flight. A batch is a small JSON document with a clear owner, so it is stored
 * as one rather than shredded across tables — the engine reads and writes it
 * whole, and a schema per field would buy nothing.
 */
export const sqliteBatchStore: BatchStore = {
  name: "sqlite",

  async save(batch: Batch): Promise<Batch> {
    getDb()
      .prepare(
        "INSERT INTO batches (id, updated_at, payload) VALUES (?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload"
      )
      .run(batch.batchId, batch.updatedAt, JSON.stringify(batch));

    evictExpired(Date.now());
    return batch;
  },

  async get(batchId: string): Promise<Batch | undefined> {
    const row = getDb()
      .prepare("SELECT payload, updated_at FROM batches WHERE id = ?")
      .get(batchId) as { payload: string; updated_at: number } | undefined;

    if (!row) return undefined;

    // Expiry is enforced on read as well as swept in the background, so a
    // batch never comes back from the dead between sweeps.
    if (Date.now() - row.updated_at > BATCH_TTL_MS) {
      getDb().prepare("DELETE FROM batches WHERE id = ?").run(batchId);
      return undefined;
    }

    try {
      return JSON.parse(row.payload) as Batch;
    } catch {
      return undefined;
    }
  },

  async delete(batchId: string): Promise<void> {
    getDb().prepare("DELETE FROM batches WHERE id = ?").run(batchId);
  },
};

/** Drop what has aged out, so the file does not grow for ever. */
function evictExpired(now: number): void {
  getDb()
    .prepare("DELETE FROM batches WHERE updated_at < ?")
    .run(now - BATCH_TTL_MS);
}

/**
 * The most recent batches, newest first.
 *
 * Not part of the `BatchStore` contract because only a store that persists can
 * answer it — which is exactly the point of this one. It is what a "my videos"
 * screen is built on.
 */
export function recentBatches(limit = 30): Batch[] {
  const rows = getDb()
    .prepare("SELECT payload FROM batches ORDER BY updated_at DESC LIMIT ?")
    .all(limit) as { payload: string }[];

  return rows
    .map((row) => {
      try {
        return JSON.parse(row.payload) as Batch;
      } catch {
        return undefined;
      }
    })
    .filter((batch): batch is Batch => Boolean(batch));
}
