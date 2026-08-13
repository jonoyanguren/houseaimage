import { describe, expect, it } from "vitest";
import { composeReel } from "@/lib/compose";
import { makeClip as clip } from "@/lib/engine/fixtures";

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
