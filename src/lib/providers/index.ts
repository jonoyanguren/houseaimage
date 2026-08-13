import type { VideoProvider } from "@/types/video";
import { higgsfieldProvider } from "@/lib/providers/higgsfield";
import { mockProvider } from "@/lib/providers/mock";

export { ProviderError, kindFromStatus, toClipFailure } from "@/lib/providers/errors";

/**
 * Provider selection.
 *
 * Resolution order:
 * 1. `VIDEO_PROVIDER` when set — an explicit choice always wins, so you can
 *    force the simulated provider while holding a valid API key.
 * 2. `higgsfield` when `HIGGSFIELD_API_KEY` is present.
 * 3. `mock` otherwise, so a fresh clone runs with no configuration at all.
 *
 * Add a backend by implementing `VideoProvider` and registering it here;
 * nothing else in the codebase knows which provider is in use.
 */

const PROVIDERS: Record<string, VideoProvider> = {
  higgsfield: higgsfieldProvider,
  mock: mockProvider,
};

export function getVideoProvider(): VideoProvider {
  const requested = process.env.VIDEO_PROVIDER?.trim().toLowerCase();

  if (requested) {
    const provider = PROVIDERS[requested];
    if (!provider) {
      throw new Error(
        `Unknown VIDEO_PROVIDER "${requested}". Available: ${Object.keys(PROVIDERS).join(", ")}`
      );
    }
    return provider;
  }

  return process.env.HIGGSFIELD_API_KEY ? higgsfieldProvider : mockProvider;
}
