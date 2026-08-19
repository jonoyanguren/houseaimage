import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetSettings,
  clearEngine,
  describeConnection,
  getEngineSelection,
  setBrand,
  setEngine,
} from "@/lib/settings";

/**
 * Two properties are worth guarding here, and both are about money.
 *
 * The environment must win over the panel — otherwise anyone who reaches the
 * settings drawer can point rendering at their own account. And no secret may
 * appear in what the panel is sent back.
 */

const ORIGINAL = process.env.HIGGSFIELD_API_KEY;

beforeEach(() => {
  delete process.env.HIGGSFIELD_API_KEY;
  __resetSettings();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.HIGGSFIELD_API_KEY;
  else process.env.HIGGSFIELD_API_KEY = ORIGINAL;
  __resetSettings();
});

const apiConfig = { apiKey: "hf_secreto1234" };

describe("engine selection", () => {
  it("reports nothing configured on a fresh clone", () => {
    expect(getEngineSelection()).toMatchObject({ source: "none" });
    expect(describeConnection("mock").connected).toBe(false);
  });

  it("stores a plugin connected from the panel", () => {
    setEngine({ pluginId: "higgsfield-api", config: apiConfig, verified: true, at: 1 });

    expect(getEngineSelection()).toMatchObject({
      pluginId: "higgsfield-api",
      source: "runtime",
    });
    expect(getEngineSelection().config.apiKey).toBe("hf_secreto1234");
  });

  it("keeps each transport's own configuration", () => {
    // MCP is the same vendor over a different wire, and its fields are not the
    // API's — a shared blob would put a key in a URL box.
    setEngine({
      pluginId: "higgsfield-mcp",
      config: { url: "https://mcp.test/mcp", token: "t0ken9999" },
      verified: true,
      at: 1,
    });

    const connection = describeConnection("higgsfield-mcp");
    expect(connection.transport).toBe("mcp");
    expect(connection.values.url).toBe("https://mcp.test/mcp");
  });

  it("ignores a half-filled configuration instead of failing every clip", () => {
    // `command` alone is not enough for the CLI plugin's contract.
    setEngine({ pluginId: "cli", config: { args: "--x" }, verified: false, at: 1 });
    expect(getEngineSelection().source).toBe("none");
  });

  it("refuses a plugin that does not exist", () => {
    expect(() =>
      setEngine({ pluginId: "inventado", config: {}, verified: false, at: 1 })
    ).toThrow(/plugin/);
  });

  it("lets the environment win over the panel", () => {
    setEngine({
      pluginId: "higgsfield-mcp",
      config: { url: "https://mcp.test/mcp" },
      verified: true,
      at: 1,
    });
    process.env.HIGGSFIELD_API_KEY = "hf_delentorno";

    const selection = getEngineSelection();
    expect(selection.pluginId).toBe("higgsfield-api");
    expect(selection.config.apiKey).toBe("hf_delentorno");
    expect(describeConnection("higgsfield").locked).toBe(true);
  });

  it("refuses to overwrite or clear an environment key", () => {
    process.env.HIGGSFIELD_API_KEY = "hf_delentorno";

    expect(() =>
      setEngine({ pluginId: "higgsfield-api", config: apiConfig, verified: false, at: 1 })
    ).toThrow(/entorno/);
    expect(() => clearEngine()).toThrow(/entorno/);
  });

  it("never puts a secret in what the browser is sent", () => {
    setEngine({ pluginId: "higgsfield-api", config: apiConfig, verified: true, at: 1 });
    const connection = describeConnection("higgsfield");

    // The hint tells two keys apart and is useless to a thief.
    expect(connection.keyHint).toBe("1234");
    expect(connection.values.apiKey).toBe("····1234");
    expect(JSON.stringify(connection)).not.toContain("hf_secreto1234");
  });

  it("masks a short secret without revealing its length", () => {
    setEngine({ pluginId: "higgsfield-api", config: { apiKey: "abc" }, verified: true, at: 1 });
    expect(describeConnection("higgsfield").values.apiKey).toBe("····");
  });

  it("returns non-secret configuration as typed, so the panel can show it", () => {
    setEngine({
      pluginId: "higgsfield-api",
      config: { apiKey: "hf_x1234", baseUrl: "https://api.test/v2" },
      verified: true,
      at: 1,
    });

    expect(describeConnection("higgsfield").values.baseUrl).toBe("https://api.test/v2");
  });

  it("falls back to the simulated engine once disconnected", () => {
    setEngine({ pluginId: "higgsfield-api", config: apiConfig, verified: true, at: 1 });
    clearEngine();
    expect(getEngineSelection().source).toBe("none");
  });

  it("does not alias the caller's config object", () => {
    // The caller is a request body; nothing that outlives a request may hold a
    // reference to one.
    const config = { apiKey: "hf_mutable123" };
    setEngine({ pluginId: "higgsfield-api", config, verified: true, at: 1 });
    config.apiKey = "cambiada";

    expect(getEngineSelection().config.apiKey).toBe("hf_mutable123");
  });
});

describe("brand", () => {
  it("merges one field at a time", () => {
    setBrand({ agencyName: "Fincas del Mar" });
    const brand = setBrand({ endCard: true });

    expect(brand).toMatchObject({ agencyName: "Fincas del Mar", endCard: true });
  });

  it("treats blank input as absent, so no empty card is drawn", () => {
    expect(setBrand({ agencyName: "   " }).agencyName).toBeUndefined();
  });
});
