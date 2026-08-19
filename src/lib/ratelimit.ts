/**
 * In-memory rate limiting, per key.
 *
 * Two things need it for different reasons: the access code, so it cannot be
 * guessed one attempt at a time, and batch creation, so a script cannot empty
 * the provider account in a loop.
 *
 * ⚠️ Per-process, like `lock` and `jobStore`. Across instances each one
 * enforces its own share of the limit, so treat the effective limit as
 * `limit × instances` until this moves to the same store as the batches.
 */

interface Window {
  count: number;
  resetAt: number;
}

const globalForLimits = globalThis as unknown as {
  __houseaimageLimits?: Map<string, Window>;
};

const windows: Map<string, Window> = (globalForLimits.__houseaimageLimits ??=
  new Map<string, Window>());

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the window resets, for a `Retry-After` header. */
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): RateLimitResult {
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count++;

  // Opportunistic sweep — no timer, and the map only grows while traffic does.
  if (windows.size > 5_000) {
    for (const [key, window] of windows) {
      if (now >= window.resetAt) windows.delete(key);
    }
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  return {
    ok: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds,
  };
}

/**
 * Best-effort client identity for limiting.
 *
 * Proxy headers are client-controlled unless a trusted proxy sets them, so
 * this bounds accidental abuse rather than a determined attacker — the access
 * gate is what actually keeps strangers out.
 */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test seam. */
export function __resetRateLimits() {
  windows.clear();
}
