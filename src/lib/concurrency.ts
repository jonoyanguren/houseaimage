/**
 * Map over items with a bounded number of in-flight promises.
 *
 * `Promise.all(items.map(...))` starts every request at once, which is exactly
 * what provider rate limits punish. This keeps at most `limit` running while
 * preserving input order in the result — order matters here because a clip's
 * position in the array is its position in the reel.
 *
 * Rejections are not swallowed: the returned promise rejects like
 * `Promise.all` would. Callers that want per-item error handling should return
 * a result object from `fn` rather than throwing.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  const workers = Math.min(Math.max(limit, 1), items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workers }, worker));

  return results;
}
