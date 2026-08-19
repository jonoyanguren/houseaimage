import type {
  BrandSettings,
  ProviderConnection,
  PublicSettings,
  RuntimeSettings,
  SettingsSource,
} from "@/types/settings";
import type { PluginConfig } from "@/types/plugin";
import type { VisionSettings } from "@/types/vision";
import { getPlugin, secretFields, toPublicPlugins } from "@/lib/providers/plugins";
import { isConnected } from "@/lib/mcp/connection";

/**
 * Runtime settings store.
 *
 * Until this existed the only way to connect an engine was to edit `.env.local`
 * and restart the server, which is not something you can ask a customer to do.
 * The settings panel writes here instead, and everything that needs
 * credentials reads from here rather than from `process.env` directly.
 *
 * Precedence is deliberate: **the environment always wins.** A key set in
 * `.env` is an operator decision made outside the app, and letting a browser
 * override it would mean anyone who reaches the panel can redirect spending to
 * their own account. When the env sets one, the panel shows it as locked.
 *
 * ⚠️ Per-process and in memory, like `jobStore` and `lock`. A restart falls
 * back to whatever the environment provides. Persisting credentials means
 * encrypting them at rest against a real key store, and that decision belongs
 * with the one to add a database — see the production notes in the README.
 */

const globalForSettings = globalThis as unknown as {
  __houseaimageSettings?: RuntimeSettings;
};

const DEFAULT_BRAND: BrandSettings = { endCard: false, watermark: false };

/**
 * Vision is off until someone turns it on: it needs a model running somewhere,
 * and the heuristic works with nothing at all. The environment can preselect
 * it for a host that always has one.
 */
const DEFAULT_VISION: VisionSettings = {
  driver: process.env.VISION_DRIVER?.trim() === "ollama" ? "ollama" : "heuristic",
  baseUrl: process.env.OLLAMA_BASE_URL?.trim() || undefined,
  model: process.env.OLLAMA_VISION_MODEL?.trim() || undefined,
};

const settings: RuntimeSettings = (globalForSettings.__houseaimageSettings ??= {
  engine: { config: {}, verified: false },
  brand: { ...DEFAULT_BRAND },
  vision: { ...DEFAULT_VISION },
});

/** The plugin the environment pins, if any. */
const ENV_PLUGIN_ID = "higgsfield-api";

function envKey(): string | undefined {
  return process.env.HIGGSFIELD_API_KEY?.trim() || undefined;
}

function envBaseUrl(): string | undefined {
  return process.env.HIGGSFIELD_API_BASE_URL?.trim() || undefined;
}

/** Which engine will serve the next job, and with what configuration. */
export interface EngineSelection {
  /** Undefined means no engine is connected: the simulated provider serves. */
  pluginId?: string;
  config: PluginConfig;
  source: SettingsSource;
  /** True when the environment owns it and the panel must not change it. */
  locked: boolean;
}

/**
 * The engine in effect.
 *
 * Server-only. Anything heading for the browser goes through
 * `describeConnection`, which masks every secret the plugin declares.
 */
export function getEngineSelection(): EngineSelection {
  const key = envKey();

  if (key) {
    return {
      pluginId: ENV_PLUGIN_ID,
      config: { apiKey: key, baseUrl: envBaseUrl() ?? "" },
      source: "env",
      locked: true,
    };
  }

  const plugin = getPlugin(settings.engine.pluginId);

  // A half-filled configuration is the same as none: better to fall back to
  // the simulated provider, which is honest, than to fail every clip.
  if (plugin && plugin.isConfigured(settings.engine.config)) {
    return {
      pluginId: plugin.id,
      config: { ...settings.engine.config },
      source: "runtime",
      locked: false,
    };
  }

  return { config: {}, source: "none", locked: false };
}

/** Store a configuration entered in the panel. Refused when the env owns it. */
export function setEngine(input: {
  pluginId: string;
  config: PluginConfig;
  verified: boolean;
  at: number;
}): void {
  if (envKey()) {
    throw new Error(
      "El motor está fijado por la variable de entorno HIGGSFIELD_API_KEY y no se puede cambiar desde aquí."
    );
  }

  if (!getPlugin(input.pluginId)) {
    throw new Error(`No existe ningún plugin con id "${input.pluginId}".`);
  }

  settings.engine = {
    pluginId: input.pluginId,
    // Copied rather than kept by reference: the caller's object is a request
    // body, and nothing that outlives a request should alias one.
    config: { ...input.config },
    verified: input.verified,
    verifiedAt: input.at,
  };
}

/** Disconnect, falling back to the simulated provider. */
export function clearEngine(): void {
  if (envKey()) {
    throw new Error(
      "El motor está fijado por la variable de entorno HIGGSFIELD_API_KEY y no se puede quitar desde aquí."
    );
  }

  settings.engine = { config: {}, verified: false };
}

/**
 * Mask a secret down to something an operator can recognise and a thief
 * cannot use: the last four characters, and never fewer than the mask.
 */
function maskSecret(value: string): string {
  return value.length <= 4 ? "····" : `····${value.slice(-4)}`;
}

/**
 * The connection as the browser may see it.
 *
 * Values come back so the panel can show what is configured, but every field
 * the plugin declared as `secret` is replaced by its mask on the way out.
 * There is no code path that returns a live secret to a client.
 */
export function describeConnection(providerName: string): ProviderConnection {
  const selection = getEngineSelection();
  const plugin = getPlugin(selection.pluginId);

  const secrets = plugin ? new Set(secretFields(plugin)) : new Set<string>();
  const values: Record<string, string> = {};
  let keyHint: string | undefined;

  for (const [name, value] of Object.entries(selection.config)) {
    if (!value) continue;

    if (secrets.has(name)) {
      values[name] = maskSecret(value);
      keyHint ??= value.slice(-4);
      continue;
    }

    values[name] = value;
  }

  // A remote MCP server is authorised in a browser, not configured with a
  // pasted value, so "connected" alone would overstate what is in place.
  const remoteMcp =
    plugin?.id === "higgsfield-mcp" &&
    Boolean(selection.config.url) &&
    !selection.config.command;

  return {
    provider: providerName,
    pluginId: plugin?.id,
    label: plugin?.label ?? "Proveedor simulado",
    transport: plugin?.transport,
    connected: Boolean(plugin),
    source: selection.source,
    values,
    keyHint,
    needsAuthorization: remoteMcp,
    authorized: remoteMcp ? isConnected(selection.config.url) : undefined,
    verified: selection.source === "env" ? true : settings.engine.verified,
    verifiedAt: settings.engine.verifiedAt,
    locked: selection.locked,
  };
}

export function getVision(): VisionSettings {
  return { ...settings.vision };
}

/**
 * Update the classifier.
 *
 * Switching away from a driver keeps its address and model rather than wiping
 * them, so turning vision off and on again does not mean typing the model name
 * a second time.
 */
export function setVision(patch: Partial<VisionSettings>): VisionSettings {
  settings.vision = {
    driver: patch.driver ?? settings.vision.driver,
    baseUrl: (patch.baseUrl ?? settings.vision.baseUrl)?.trim() || undefined,
    model: (patch.model ?? settings.vision.model)?.trim() || undefined,
  };
  return getVision();
}

export function getBrand(): BrandSettings {
  return { ...settings.brand };
}

/** Merge a partial update, so the panel can save one field at a time. */
export function setBrand(patch: Partial<BrandSettings>): BrandSettings {
  settings.brand = {
    ...settings.brand,
    ...patch,
    agencyName: (patch.agencyName ?? settings.brand.agencyName)?.trim() || undefined,
    contact: (patch.contact ?? settings.brand.contact)?.trim() || undefined,
  };
  return getBrand();
}

/** True when an access code is configured, so the UI can say the app is gated. */
export function hasAccessGate(): boolean {
  return Boolean(process.env.APP_ACCESS_CODE?.trim());
}

/**
 * Async because it probes the stitching backend, which shells out to `ffmpeg
 * -encoders` the first time. That probe is cached, so this is one process
 * spawn per server lifetime rather than one per request.
 */
export async function toPublicSettings(
  providerName: string
): Promise<PublicSettings> {
  const { getStitchProvider } = await import("@/lib/stitch");

  return {
    connection: describeConnection(providerName),
    plugins: toPublicPlugins(),
    brand: getBrand(),
    vision: getVision(),
    accessGate: hasAccessGate(),
    canDeliverFile: (await getStitchProvider()) !== null,
  };
}

/** Test seam: back to a pristine store. */
export function __resetSettings() {
  settings.engine = { config: {}, verified: false };
  settings.brand = { ...DEFAULT_BRAND };
  settings.vision = { ...DEFAULT_VISION };
}
