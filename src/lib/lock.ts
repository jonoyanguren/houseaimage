/**
 * Per-key serialisation.
 *
 * Refreshing a batch is read-modify-write, and nothing stopped two of them
 * running at once. Two browser tabs polling the same batch both saw the same
 * failed clip, and both re-submitted it — the customer paid twice to render
 * the same photo. A `POST /retry` crossing a poll did the same.
 *
 * Serialising by `batchId` fixes it together with re-reading the batch inside
 * the lock: the second caller then sees the first one's result and finds
 * nothing left to retry.
 *
 * ⚠️ This is a single-process lock. It is enough for local development and one
 * long-lived server, and useless across instances — the same place
 * `src/lib/jobStore` needs a real backend, this needs a real lock (`SET NX`
 * with a TTL in Redis, or `SELECT … FOR UPDATE` in Postgres). Whoever
 * implements a distributed `BatchStore` must implement this too, or the
 * double-spend comes straight back.
 *
 * Held on `globalThis` so a dev-server hot reload doesn't hand out two
 * independent lock tables for the same batch.
 */

const globalForLocks = globalThis as unknown as {
  __houseaimageLocks?: Map<string, Promise<unknown>>;
};

const chains: Map<string, Promise<unknown>> =
  globalForLocks.__houseaimageLocks ?? new Map<string, Promise<unknown>>();

globalForLocks.__houseaimageLocks = chains;

/**
 * Run `fn` once every earlier call for the same key has finished.
 *
 * Callers get their own result and their own errors; a rejection never leaks
 * into whoever is queued behind them.
 */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();

  // Run after the previous holder settles, whatever its outcome — a failed
  // refresh must not block every later one.
  const result = previous.then(fn, fn);

  // The queue itself must never reject, or the rejection propagates to every
  // caller that queues up afterwards.
  const chain: Promise<unknown> = result.then(
    () => undefined,
    () => undefined
  );

  chains.set(key, chain);

  void chain.then(() => {
    // Only clear it if nobody else queued behind us in the meantime.
    if (chains.get(key) === chain) chains.delete(key);
  });

  return result;
}
