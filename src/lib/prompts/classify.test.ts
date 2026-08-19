import { describe, expect, it } from "vitest";
import { classifyPhoto, sceneFromFilename, suggestSceneType } from "@/lib/prompts";

/**
 * The scene decides the camera movement, so a wrong guess here is a wrongly
 * moving clip the customer paid for. These tests care about two things in
 * particular: that a real name is recognised, and that a meaningless one is
 * *not* forced into a category.
 */

describe("sceneFromFilename", () => {
  it("reads the room from a plain name", () => {
    expect(sceneFromFilename("cocina.jpg")).toBe("cocina");
    expect(sceneFromFilename("salon-2.png")).toBe("salon");
    expect(sceneFromFilename("bano principal.jpeg")).toBe("bano");
  });

  it("survives accents, case and separators", () => {
    expect(sceneFromFilename("Salón_02.JPG")).toBe("salon");
    expect(sceneFromFilename("JARDÍN-trasero.webp")).toBe("jardin");
    expect(sceneFromFilename("Terraza+Ática.png")).toBe("terraza");
  });

  it("reads English exports too", () => {
    expect(sceneFromFilename("master-bedroom.jpg")).toBe("dormitorio");
    expect(sceneFromFilename("kitchen_01.jpg")).toBe("cocina");
    expect(sceneFromFilename("pool.jpg")).toBe("piscina");
  });

  it("says nothing for a camera's own filename", () => {
    // The alternative is matching a fragment inside a serial number, which
    // would classify photos at random.
    expect(sceneFromFilename("IMG_2481.JPG")).toBeUndefined();
    expect(sceneFromFilename("DSC00123.jpg")).toBeUndefined();
    expect(sceneFromFilename("PXL_20240612.jpg")).toBeUndefined();
  });

  it("says nothing rather than guessing at an unknown name", () => {
    expect(sceneFromFilename("anuncio-final-v3.jpg")).toBeUndefined();
  });
});

describe("suggestSceneType — positional fallback", () => {
  it("opens a house on its façade and a flat on its living room", () => {
    expect(suggestSceneType(0, 8, "casa")).toBe("fachada");
    expect(suggestSceneType(0, 8, "piso")).toBe("salon");
  });

  it("leaves the middle of a listing neutral", () => {
    // Deliberate: neutral motion is better than confidently wrong motion.
    expect(suggestSceneType(4, 10, "piso")).toBe("generico");
  });
});

describe("classifyPhoto", () => {
  it("prefers the filename over the position", () => {
    // Position alone would call the first photo of a flat the living room.
    expect(
      classifyPhoto({ fileName: "cocina.jpg", index: 0, total: 6, propertyType: "piso" })
    ).toBe("cocina");
  });

  it("falls back to position when the name says nothing", () => {
    expect(
      classifyPhoto({ fileName: "IMG_0001.jpg", index: 0, total: 6, propertyType: "casa" })
    ).toBe("fachada");
  });
});
