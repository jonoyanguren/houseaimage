import type {
  PluginConfig,
  PluginTransport,
  PublicPlugin,
} from "@/types/plugin";
import type { VisionSettings } from "@/types/vision";

/**
 * Runtime settings: the things an operator configures from the interface
 * instead of from a `.env` file and a server restart.
 *
 * Two groups, with very different sensitivities:
 *
 * - `engine`   — which plugin renders, and its configuration. Credentials in
 *   it never leave the server: what the browser gets is `ProviderConnection`,
 *   a description of the connection with every secret masked.
 * - `brand`     — the agency's identity, stamped onto the delivered video.
 *   Harmless, and returned as-is.
 */

/** Where a value in effect came from. */
export type SettingsSource = "runtime" | "env" | "none";

/**
 * What the browser is allowed to know about the connection.
 *
 * `values` carries the configuration back so the panel can show what is set,
 * with every field the plugin declared as `secret` already masked. There is no
 * path that returns a live secret to a client.
 */
export interface ProviderConnection {
  /** Provider actually in effect right now. */
  provider: string;
  /** Which plugin is connected, or undefined when none is. */
  pluginId?: string;
  label: string;
  transport?: PluginTransport;
  connected: boolean;
  source: SettingsSource;
  /** Configuration as typed, secrets masked. */
  values: Record<string, string>;
  /** Last four characters of the first secret, for a compact readout. */
  keyHint?: string;
  /** When the configuration was last checked against the engine. */
  verifiedAt?: number;
  /** False when it is stored but the check could not be completed. */
  verified: boolean;
  /** True when the value comes from the environment and the UI cannot change it. */
  locked: boolean;
  /**
   * True when this engine is reached through a browser authorisation rather
   * than a pasted credential, so the panel has to offer the button instead of
   * a field.
   */
  needsAuthorization?: boolean;
  /** True once that authorisation is in place and a token is held. */
  authorized?: boolean;
}

/** Result of checking credentials against the provider. */
export interface ProviderVerification {
  /** The credentials are usable as far as we can tell. */
  ok: boolean;
  /** We actually confirmed them against the provider, rather than assuming. */
  verified: boolean;
  message: string;
}

/**
 * Agency identity, burned into the delivered file.
 *
 * This is what turns a montage into something an agency will actually publish:
 * their name on the closing card and their mark in the corner.
 */
export interface BrandSettings {
  agencyName?: string;
  contact?: string;
  /** Stored URL of the agency logo, uploaded through the settings panel. */
  logoUrl?: string;
  /** Closing card with the agency's name and contact details. */
  endCard: boolean;
  /** Discreet mark in a corner throughout the reel. */
  watermark: boolean;
}

export interface RuntimeSettings {
  /** Who looks at the photos and says what they are. */
  vision: VisionSettings;
  engine: {
    /** Undefined means nothing is connected and the simulated provider serves. */
    pluginId?: string;
    config: PluginConfig;
    verifiedAt?: number;
    verified: boolean;
  };
  brand: BrandSettings;
}

/** Everything the settings panel needs, with nothing secret in it. */
export interface PublicSettings {
  connection: ProviderConnection;
  /** Every engine that can be connected, with the fields each one needs. */
  plugins: PublicPlugin[];
  brand: BrandSettings;
  /** The photo classifier in effect. Nothing here is secret for a local model. */
  vision: VisionSettings;
  /** True when an access code is configured, so the UI can say so. */
  accessGate: boolean;
  /**
   * Whether this host can assemble the downloadable file.
   *
   * Surfaced because it changes what the customer walks away with: without a
   * stitching backend the reel is watchable in the page and there is no MP4 to
   * send, and finding that out after paying for twelve renders is too late.
   */
  canDeliverFile: boolean;
}
