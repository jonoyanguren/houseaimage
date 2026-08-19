import type { ProviderPlugin, PublicPlugin } from "@/types/plugin";
import { higgsfieldApiPlugin } from "@/lib/providers/higgsfield";
import { higgsfieldMcpPlugin } from "@/lib/providers/higgsfield-mcp";
import { cliPlugin } from "@/lib/providers/higgsfield-cli";

/**
 * The plugin catalogue.
 *
 * Order is the order the settings panel offers them, and it is a
 * recommendation: the API first because it works on any host with nothing but
 * a key, MCP second for an operator who already has the server connected, and
 * the command line last because it runs a process on the server and needs an
 * explicit opt-in.
 *
 * The simulated provider is not here on purpose. It is the *absence* of a
 * plugin, not a choice among them — see `src/lib/providers/index.ts`.
 */
export const PLUGINS: readonly ProviderPlugin[] = [
  higgsfieldApiPlugin,
  higgsfieldMcpPlugin,
  cliPlugin,
];

export function getPlugin(id: string | undefined): ProviderPlugin | undefined {
  if (!id) return undefined;
  return PLUGINS.find((plugin) => plugin.id === id);
}

/**
 * The catalogue as the browser may see it: shapes, never values. The panel
 * renders its form from this, so adding a field to a plugin adds an input
 * without touching a component.
 */
export function toPublicPlugins(): PublicPlugin[] {
  return PLUGINS.map(({ id, label, description, transport, fields }) => ({
    id,
    label,
    description,
    transport,
    fields,
  }));
}

/** Field names a plugin declares as secret, for masking on the way out. */
export function secretFields(plugin: ProviderPlugin): string[] {
  return plugin.fields.filter((field) => field.kind === "secret").map((f) => f.name);
}
