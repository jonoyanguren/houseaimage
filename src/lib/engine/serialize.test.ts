import { describe, expect, it } from "vitest";
import type { Batch } from "@/types/video";
import { makeClip } from "@/lib/engine/fixtures";
import { toPublicBatch, toPublicClip } from "@/lib/engine/serialize";

function makeBatch(clips = [makeClip(0, "completed")]): Batch {
  return {
    batchId: "batch-1",
    status: "completed",
    createdAt: 0,
    updatedAt: 0,
    options: { styleId: "dron", propertyType: "casa", prompt: "luz de tarde" },
    clips,
  };
}

describe("toPublicBatch", () => {
  it("never lets the composed prompt reach the client", () => {
    // The prompt catalogue is the product's craft. In the response body it
    // would sit one devtools tab away from anyone.
    const serialised = JSON.stringify(toPublicBatch(makeBatch()));

    expect(serialised).not.toContain("aerial drone");
    expect(serialised).not.toContain("architectural lines");
    expect(serialised).not.toMatch(/"resolved"/);
  });

  it("withholds the provider job id", () => {
    const [clip] = toPublicBatch(makeBatch()).clips;
    expect(clip).not.toHaveProperty("providerJobId");
  });

  it("flattens the failure into a plain message", () => {
    const failed = makeClip(0, "failed", { failureKind: "rate_limited" });
    const clip = toPublicClip(failed);

    expect(clip.error).toBe("boom");
    // The taxonomy is ours; the UI has no business branching on it.
    expect(clip).not.toHaveProperty("failure");
  });

  it("tells the client when the engine is going to retry by itself", () => {
    // So the UI can say "reintentando" rather than showing a failure that is
    // already being fixed.
    const pending = makeClip(0, "failed", { attempts: 1 });
    const dead = makeClip(1, "failed", { failureKind: "invalid_input", attempts: 1 });

    expect(toPublicClip(pending).willRetry).toBe(true);
    expect(toPublicClip(dead).willRetry).toBe(false);
  });

  it("keeps what the UI legitimately needs", () => {
    const publicBatch = toPublicBatch(makeBatch());

    expect(publicBatch.batchId).toBe("batch-1");
    expect(publicBatch.styleId).toBe("dron");
    expect(publicBatch.propertyType).toBe("casa");
    expect(publicBatch.clips[0].imageUrl).toContain("https://");
    expect(publicBatch.clips[0].index).toBe(0);
  });

  it("does not echo the user's own prompt back inside options", () => {
    // `options` as a whole is internal; only the two fields the UI needs are
    // projected, so adding an option later cannot leak by accident.
    expect(toPublicBatch(makeBatch())).not.toHaveProperty("options");
  });
});
