import { describe, expect, it } from "vitest";
import { makeClip as clip } from "@/lib/engine/fixtures";
import { deriveBatchStatus, isUsable } from "@/lib/engine/state";

describe("deriveBatchStatus", () => {
  it("stays processing while any clip is unsettled", () => {
    expect(deriveBatchStatus([clip(0, "completed"), clip(1, "processing")])).toBe(
      "processing"
    );
    expect(deriveBatchStatus([clip(0, "queued")])).toBe("processing");
  });

  it("stays processing when every clip failed but retries remain", () => {
    // The provider rejecting a whole batch at once — a rate limit, a brief
    // outage — must not be reported as a dead batch.
    const rejected = [clip(0, "failed", { attempts: 1 }), clip(1, "failed", { attempts: 1 })];

    expect(deriveBatchStatus(rejected)).toBe("processing");
  });

  it("is completed only when every clip succeeded", () => {
    expect(deriveBatchStatus([clip(0, "completed"), clip(1, "completed")])).toBe(
      "completed"
    );
  });

  it("is partial when some succeeded and some failed", () => {
    // The whole point: one bad photo out of ten must not lose the other nine.
    expect(deriveBatchStatus([clip(0, "completed"), clip(1, "failed")])).toBe(
      "partial"
    );
  });

  it("is failed only when nothing usable survived", () => {
    expect(deriveBatchStatus([clip(0, "failed"), clip(1, "failed")])).toBe("failed");
    expect(deriveBatchStatus([])).toBe("failed");
  });

  it("treats a completed clip with no video as unusable", () => {
    // A provider contract violation must not leave a silent gap in the reel.
    const broken = clip(0, "completed", { videoUrl: undefined });
    expect(deriveBatchStatus([broken])).toBe("failed");
  });

  it("counts a simulated clip as usable despite having no video", () => {
    const simulated = clip(0, "completed", { videoUrl: undefined, simulated: true });
    expect(deriveBatchStatus([simulated])).toBe("completed");
  });
});

describe("isUsable", () => {
  it("accepts a simulated clip even though it has no video", () => {
    // Simulated clips still occupy their slot in the montage.
    expect(isUsable(clip(0, "completed", { videoUrl: undefined, simulated: true }))).toBe(
      true
    );
  });

  it("rejects a completed clip that produced nothing", () => {
    expect(isUsable(clip(0, "completed", { videoUrl: undefined }))).toBe(false);
  });
});
