import type { VideoProvider } from "@/types/video";

/**
 * Video engines as plugins.
 *
 * There was already one seam here — `VideoProvider` — and it was enough while
 * every backend was reached the same way: an HTTP API with a bearer token. It
 * stopped being enough the moment the same vendor became reachable three ways:
 * its REST API, its MCP server, and a command line on the host. Those differ
 * in *transport*, not in what they do, and each needs different things
 * configured: a key and a URL, or a server command, or a binary path.
 *
 * So a plugin is a `VideoProvider` plus the two things the interface needs to
 * offer it honestly: what to ask the operator for, and what it can do.
 *
 * Adding one is a module and a line in the registry. Nothing else in the
 * codebase learns that it exists.
 */

/** How the engine is reached. Drives the copy and the diagnostics, nothing else. */
export type PluginTransport = "api" | "mcp" | "cli";

/** One thing the operator has to supply for a plugin to work. */
export interface PluginField {
  name: string;
  label: string;
  hint?: string;
  /**
   * `secret` never comes back to the browser — only a four-character hint.
   * `command` is run on the host, which is why it is marked as its own kind:
   * see the warning in `higgsfield-cli.ts`.
   * `model` is a chooser filled from the backend's own catalogue, so nobody
   * has to type an id from a blog post that may have been retired since.
   */
  kind: "secret" | "text" | "url" | "command" | "model";
  required?: boolean;
  placeholder?: string;
  /** Used when the operator leaves it blank. */
  fallback?: string;
}

export interface ProviderPlugin {
  id: string;
  label: string;
  /** One line, shown under the name in the picker. */
  description: string;
  transport: PluginTransport;
  fields: readonly PluginField[];
  /**
   * Build the provider from the operator's configuration.
   *
   * Called per operation rather than cached, because the configuration can
   * change between one batch and the next and a stale closure would keep
   * spending on the old account.
   */
  create(config: PluginConfig): VideoProvider;
  /**
   * Everything the plugin needs is present. Checked before we let the operator
   * connect, so a half-filled form fails here rather than mid-batch.
   */
  isConfigured(config: PluginConfig): boolean;
  /**
   * True when this backend fetches the photographs itself over public HTTPS,
   * so a local development address makes every clip fail.
   *
   * False for a backend that takes the bytes — which is worth a great deal
   * more than a flag: it is the difference between needing a tunnel or a
   * deployment to try the product, and needing nothing at all.
   */
  needsPublicPhotos: boolean;
}

/** Raw values as the operator typed them, keyed by field name. */
export type PluginConfig = Record<string, string>;

/** A plugin as the browser may see it: no values, only the shape. */
export interface PublicPlugin {
  id: string;
  label: string;
  description: string;
  transport: PluginTransport;
  fields: readonly PluginField[];
}
