import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROPERTY_TYPE,
  DEFAULT_STYLE_ID,
  PROPERTY_LIST,
  SCENE_LIST,
  STYLE_LIST,
  buildClipPrompt,
  scenesForProperty,
  stylesForProperty,
  suggestSceneType,
} from "@/lib/prompts";
import { PROPERTY_PROFILES } from "@/lib/prompts/properties";
import { SCENE_PROFILES } from "@/lib/prompts/scenes";
import { STYLE_PRESETS } from "@/lib/prompts/styles";

describe("buildClipPrompt", () => {
  it("composes the three axes in weight order", () => {
    const { prompt } = buildClipPrompt({
      styleId: "cinematografico",
      propertyType: "piso",
      sceneType: "cocina",
    });

    const style = prompt.indexOf(STYLE_PRESETS.cinematografico.base);
    const property = prompt.indexOf(PROPERTY_PROFILES.piso.context);
    const scene = prompt.indexOf(SCENE_PROFILES.cocina.motion);

    // The model weights early clauses more heavily, so the order is contractual.
    expect(style).toBeGreaterThanOrEqual(0);
    expect(property).toBeGreaterThan(style);
    expect(scene).toBeGreaterThan(property);
  });

  it("puts the hard constraints last so nothing dilutes them", () => {
    const { prompt } = buildClipPrompt({
      styleId: "tour",
      sceneType: "salon",
      extra: "luz de tarde",
    });

    expect(prompt.indexOf("luz de tarde")).toBeLessThan(
      prompt.indexOf("architectural lines stay perfectly straight")
    );
    expect(prompt.endsWith("photorealistic")).toBe(true);
  });

  it("omits the user's text when it is blank", () => {
    const { prompt } = buildClipPrompt({
      styleId: "tour",
      sceneType: "salon",
      extra: "   ",
    });

    expect(prompt).not.toContain(",  ,");
    expect(prompt).not.toMatch(/,\s*,/);
  });

  it("lets a style override a scene's default motion", () => {
    // The canonical clash: aerial language applied to an interior would have
    // the model invent an impossible camera.
    const { prompt } = buildClipPrompt({
      styleId: "dron",
      sceneType: "cocina",
    });

    expect(prompt).toContain(STYLE_PRESETS.dron.sceneOverrides.cocina);
    expect(prompt).not.toContain(SCENE_PROFILES.cocina.motion);
    expect(prompt).toContain("no aerial ascent");
  });

  it("uses the scene default when the style declares no override", () => {
    const { prompt } = buildClipPrompt({
      styleId: "dinamico",
      sceneType: "cocina",
    });

    expect(prompt).toContain(SCENE_PROFILES.cocina.motion);
  });

  it("changes only the property clause when only the property changes", () => {
    const common = { styleId: "tour", sceneType: "salon" } as const;
    const flat = buildClipPrompt({ ...common, propertyType: "piso" }).prompt;
    const rural = buildClipPrompt({ ...common, propertyType: "rustico" }).prompt;

    expect(flat).not.toBe(rural);
    expect(flat.replace(PROPERTY_PROFILES.piso.context, "@")).toBe(
      rural.replace(PROPERTY_PROFILES.rustico.context, "@")
    );
  });

  it("carries format and duration from the chosen style", () => {
    const resolved = buildClipPrompt({ styleId: "dinamico", sceneType: "salon" });

    expect(resolved.aspectRatio).toBe(STYLE_PRESETS.dinamico.aspectRatio);
    expect(resolved.durationSeconds).toBe(STYLE_PRESETS.dinamico.durationSeconds);
  });

  it("returns the negative prompt separately from the positive one", () => {
    const { prompt, negative } = buildClipPrompt({
      styleId: "editorial",
      sceneType: "detalle",
    });

    expect(negative).toBe(STYLE_PRESETS.editorial.negative);
    expect(prompt).not.toContain(negative);
  });

  it("falls back to defaults instead of throwing on unknown input", () => {
    // Input reaches this from an HTTP body, so it must degrade rather than 500.
    const resolved = buildClipPrompt({
      styleId: "no-existe",
      propertyType: "tampoco",
      sceneType: "inventado",
    });

    expect(resolved.styleId).toBe(DEFAULT_STYLE_ID);
    expect(resolved.propertyType).toBe(DEFAULT_PROPERTY_TYPE);
    expect(resolved.sceneType).toBe("generico");
  });
});

describe("catalogue integrity", () => {
  it("keeps every model-facing field free of Spanish", () => {
    // The models follow English camera vocabulary far more reliably, so a
    // translated prompt is a silent quality regression.
    const spanish = /[ñáéíóú]|(?:^|\s)(?:la|el|de|con|cámara|lento)(?:\s|$)/i;

    for (const style of STYLE_LIST) {
      expect(style.base, style.id).not.toMatch(spanish);
      expect(style.negative, style.id).not.toMatch(spanish);
    }
    for (const scene of SCENE_LIST) {
      expect(scene.motion, scene.id).not.toMatch(spanish);
    }
    for (const property of PROPERTY_LIST) {
      expect(property.context, property.id).not.toMatch(spanish);
    }
  });

  it("only overrides scenes that exist", () => {
    for (const style of STYLE_LIST) {
      for (const sceneId of Object.keys(style.sceneOverrides ?? {})) {
        expect(SCENE_PROFILES, `${style.id} → ${sceneId}`).toHaveProperty(sceneId);
      }
    }
  });

  it("only recommends styles and scenes that exist", () => {
    for (const property of PROPERTY_LIST) {
      for (const styleId of property.recommendedStyles) {
        expect(STYLE_PRESETS, property.id).toHaveProperty(styleId);
      }
      for (const sceneId of property.primaryScenes) {
        expect(SCENE_PROFILES, property.id).toHaveProperty(sceneId);
      }
    }
  });
});

describe("property-driven ordering", () => {
  it("leads with a recommended style and never drops any", () => {
    const ordered = stylesForProperty("rustico");

    expect(ordered[0].style.id).toBe(PROPERTY_PROFILES.rustico.recommendedStyles[0]);
    expect(ordered[0].recommended).toBe(true);
    expect(ordered).toHaveLength(STYLE_LIST.length);
  });

  it("ranks a flat and a country property differently", () => {
    expect(stylesForProperty("piso")[0].style.id).not.toBe(
      stylesForProperty("rustico")[0].style.id
    );
  });

  it("reorders scenes without ever hiding one", () => {
    // A flat in a development really can have communal areas, so a wrong
    // whitelist would be worse than a wrong order.
    const ordered = scenesForProperty("piso");

    expect(ordered).toHaveLength(SCENE_LIST.length);
    expect(ordered[0].id).toBe(PROPERTY_PROFILES.piso.primaryScenes[0]);
    expect(ordered.map((s) => s.id)).toContain("piscina");
  });
});

describe("suggestSceneType", () => {
  it("opens a house on the façade and a flat on the living room", () => {
    // A flat has no façade of its own to show.
    expect(suggestSceneType(0, 5, "casa")).toBe("fachada");
    expect(suggestSceneType(0, 5, "piso")).toBe("salon");
  });

  it("leaves the middle of the listing neutral rather than guessing", () => {
    // A wrong scene produces worse motion than a neutral one.
    expect(suggestSceneType(3, 8, "casa")).toBe("generico");
  });

  it("never returns a scene that does not exist", () => {
    for (const property of PROPERTY_LIST) {
      for (let i = 0; i < 6; i++) {
        expect(SCENE_PROFILES).toHaveProperty(suggestSceneType(i, 6, property.id));
      }
    }
  });
});
