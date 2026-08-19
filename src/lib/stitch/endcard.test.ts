import { describe, expect, it } from "vitest";
import { hasEndCardContent, renderEndCard } from "@/lib/stitch/endcard";

/**
 * The closing card is drawn, not composited by ffmpeg, so it is worth proving
 * it actually produces an image here — the alternative is finding out inside a
 * filter graph, where the failure is silent by design.
 */

describe("hasEndCardContent", () => {
  it("is false when the card is off, whatever else is filled in", () => {
    expect(
      hasEndCardContent({ endCard: false, watermark: false, agencyName: "Fincas" })
    ).toBe(false);
  });

  it("is false when there is nothing to write on it", () => {
    // Drawing an empty black card onto the end of the video is worse than
    // ending on the last room.
    expect(hasEndCardContent({ endCard: true, watermark: false })).toBe(false);
  });

  it("is true as soon as there is a name, a contact or a logo", () => {
    expect(
      hasEndCardContent({ endCard: true, watermark: false, agencyName: "Fincas" })
    ).toBe(true);
    expect(
      hasEndCardContent({ endCard: true, watermark: false, contact: "600 000 000" })
    ).toBe(true);
  });
});

describe("renderEndCard", () => {
  it("renders a PNG at the reel's dimensions", async () => {
    const png = await renderEndCard(
      {
        endCard: true,
        watermark: false,
        agencyName: "Fincas del Mar",
        contact: "600 000 000 · fincasdelmar.es",
      },
      1920,
      1080
    );

    expect(png.byteLength).toBeGreaterThan(1_000);
    // PNG magic number: proves an image came back rather than an error page.
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }, 30_000);

  it("renders a vertical card too, since half the styles are 9:16", async () => {
    const png = await renderEndCard(
      { endCard: true, watermark: false, agencyName: "Fincas del Mar" },
      1080,
      1920
    );

    expect(png.byteLength).toBeGreaterThan(1_000);
  }, 30_000);
});
