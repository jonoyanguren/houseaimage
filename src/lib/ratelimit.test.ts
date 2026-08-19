import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimits, rateLimit } from "@/lib/ratelimit";

beforeEach(__resetRateLimits);

describe("rateLimit", () => {
  it("allows up to the limit and refuses the next one", () => {
    const now = 1_000;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("k", 3, 60_000, now).ok).toBe(true);
    }
    expect(rateLimit("k", 3, 60_000, now).ok).toBe(false);
  });

  it("keeps separate counts per key", () => {
    rateLimit("a", 1, 60_000, 0);
    expect(rateLimit("a", 1, 60_000, 0).ok).toBe(false);
    expect(rateLimit("b", 1, 60_000, 0).ok).toBe(true);
  });

  it("starts a fresh window once the old one passes", () => {
    rateLimit("k", 1, 60_000, 0);
    expect(rateLimit("k", 1, 60_000, 30_000).ok).toBe(false);
    expect(rateLimit("k", 1, 60_000, 60_001).ok).toBe(true);
  });

  it("reports how long to wait, for a Retry-After header", () => {
    rateLimit("k", 1, 60_000, 0);
    const refused = rateLimit("k", 1, 60_000, 15_000);

    expect(refused.ok).toBe(false);
    expect(refused.retryAfterSeconds).toBe(45);
  });
});
