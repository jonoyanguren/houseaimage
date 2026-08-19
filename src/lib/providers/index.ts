import type { VideoProvider } from "@/types/video";
import { mockProvider } from "@/lib/providers/mock";
import { getPlugin, PLUGINS } from "@/lib/providers/plugins";
import { getEngineSelection } from "@/lib/settings";

export { ProviderError, kindFromStatus, toClipFailure } from "@/lib/providers/errors";
export { normalizeStatus } from "@/lib/providers/status";
export { PLUGINS, getPlugin, toPublicPlugins } from "@/lib/providers/plugins";

/**
 * Which engine serves the next job.
 *
 * Resolution order:
 * 1. `VIDEO_PROVIDER` when set — an explicit choice always wins, so you can
 *    force the simulated provider while holding valid credentials.
 * 2. The connected plugin: from the environment, or from the settings panel.
 *    Connecting one switches the engine on the next job, with no restart.
 * 3. `mock` otherwise, so a fresh clone runs with no configuration at all.
 *
 * Note what this file does *not* contain: any knowledge of how a backend is
 * reached. REST, MCP and a local command are three plugins with three
 * transports, and only they know the difference — see `plugins.ts`.
 */
export function getVideoProvider(): VideoProvider {
  const requested = process.env.VIDEO_PROVIDER?.trim().toLowerCase();

  if (requested) {
    if (requested === "mock") return mockProvider;

    const plugin = getPlugin(requested);
    if (!plugin) {
      throw new Error(
        `Unknown VIDEO_PROVIDER "${requested}". Available: mock, ` +
          PLUGINS.map((p) => p.id).join(", ")
      );
    }

    // An explicit choice still needs its configuration; the panel or the
    // environment has to have supplied it.
    return plugin.create(getEngineSelection().config);
  }

  const selection = getEngineSelection();
  const plugin = getPlugin(selection.pluginId);

  // Built per call rather than cached: the configuration can change between
  // one batch and the next, and a stale closure would keep spending on the
  // account that was connected an hour ago.
  return plugin ? plugin.create(selection.config) : mockProvider;
}

/**
 * The provider that *would* serve the next job, by name only.
 *
 * Separate from `getVideoProvider` because the settings panel needs to report
 * the selection without an unknown `VIDEO_PROVIDER` throwing at it.
 */
export function getVideoProviderName(): string {
  try {
    return getVideoProvider().name;
  } catch {
    return "desconocido";
  }
}
