import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/concurrency";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", () => {
    // A clip's position in this array is its position in the reel, so an
    // out-of-order result would silently scramble the video.
    return expect(
      mapWithConcurrency([30, 0, 15], 3, async (delay, index) => {
        await tick(delay);
        return index;
      })
    ).resolves.toEqual([0, 1, 2]);
  });

  it("never exceeds the concurrency limit", async () => {
    let running = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }), 4, async () => {
      running++;
      peak = Math.max(peak, running);
      await tick(1);
      running--;
    });

    expect(peak).toBeLessThanOrEqual(4);
  });

  it("still processes every item when the limit is below the input size", async () => {
    const seen: number[] = [];

    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      await tick(1);
      seen.push(item);
    });

    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles an empty input without spawning workers", async () => {
    await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
  });

  it("clamps a nonsensical limit instead of hanging", async () => {
    await expect(
      mapWithConcurrency([1, 2], 0, async (item) => item * 2)
    ).resolves.toEqual([2, 4]);
  });

  it("rejects like Promise.all rather than swallowing an error", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("boom");
        return item;
      })
    ).rejects.toThrow("boom");
  });
});
