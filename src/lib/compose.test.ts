import { describe, expect, it } from "vitest";
import type { Clip, ClipStatus } from "@/types/video";
import { composeReel, deriveBatchStatus, isSettled } from "@/lib/compose";

function clip(index: number, status: ClipStatus, extra: Partial<Clip> = {}): Clip {
  return {
    clipId: `clip-${index}`,
    index,
    imageUrl: `https://example.test/${index}.jpg`,
    sceneType: "generico",
    providerJobId: `job-${index}`,
    status,
    attempts: 1,
    videoUrl: status === "completed" ? `https://example.test/${index}.mp4` : undefined,
    ...extra,
  };
}

describe("deriveBatchStatus", () => {
  it("stays processing while any clip is unsettled", () => {
    expect(deriveBatchStatus([clip(0, "completed"), clip(1, "processing")])).toBe(
      "processing"
    );
    expect(deriveBatchStatus([clip(0, "queued")])).toBe("processing");
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

describe("composeReel", () => {
  it("orders segments by index, not by completion order", () => {
    // Providers finish jobs in arbitrary order; `index` is the only thing that
    // preserves what the user arranged.
    const reel = composeReel([clip(2, "completed"), clip(0, "completed"), clip(1, "completed")]);

    expect(reel?.segments.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("returns nothing while clips are still running", () => {
    expect(composeReel([clip(0, "completed"), clip(1, "processing")])).toBeUndefined();
  });

  it("returns nothing when no clip survived", () => {
    expect(composeReel([clip(0, "failed")])).toBeUndefined();
  });

  it("skips failed clips but keeps the survivors in order", () => {
    const reel = composeReel([
      clip(0, "completed"),
      clip(1, "failed"),
      clip(2, "completed"),
    ]);

    expect(reel?.segments.map((s) => s.index)).toEqual([0, 2]);
  });

  it("lays segments on a contiguous timeline", () => {
    const reel = composeReel(
      [clip(0, "completed"), clip(1, "completed"), clip(2, "completed")],
      { styleId: "dinamico" }
    );

    // Dinámico runs on 4s cuts.
    expect(reel?.segments.map((s) => s.startAtSeconds)).toEqual([0, 4, 8]);
    expect(reel?.totalDurationSeconds).toBe(12);
  });

  it("takes clip length from the chosen style", () => {
    const cinematic = composeReel([clip(0, "completed")], {
      styleId: "cinematografico",
    });
    const social = composeReel([clip(0, "completed")], { styleId: "dinamico" });

    expect(cinematic?.totalDurationSeconds).toBe(7);
    expect(social?.totalDurationSeconds).toBe(4);
  });

  it("lets an explicit duration override the style", () => {
    const reel = composeReel([clip(0, "completed")], {
      styleId: "cinematografico",
      durationSeconds: 3,
    });

    expect(reel?.totalDurationSeconds).toBe(3);
  });

  it("defaults to the playlist strategy with no stitched file", () => {
    const reel = composeReel([clip(0, "completed")]);

    expect(reel?.strategy).toBe("sequential-playlist");
    expect(reel?.url).toBeUndefined();
  });
});

describe("isSettled", () => {
  it("treats only terminal states as settled", () => {
    expect(isSettled(clip(0, "completed"))).toBe(true);
    expect(isSettled(clip(0, "failed"))).toBe(true);
    expect(isSettled(clip(0, "queued"))).toBe(false);
    expect(isSettled(clip(0, "processing"))).toBe(false);
  });
});
