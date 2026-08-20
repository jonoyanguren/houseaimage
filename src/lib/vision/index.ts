import type { PhotoAnalyzer, VisionSettings } from "@/types/vision";
import { heuristicAnalyzer } from "@/lib/vision/heuristic";
import { createOllamaAnalyzer } from "@/lib/vision/ollama";
import { createOpenAiAnalyzer } from "@/lib/vision/openai";

export { listModels, warmUp, __resetModelCache } from "@/lib/vision/ollama";
export { heuristicAnalyzer } from "@/lib/vision/heuristic";

/**
 * Analyzer selection.
 *
 * Same shape as providers, storage, jobStore and stitch: a module per backend
 * and an `index` that picks by configuration, with a fallback that works with
 * nothing set up.
 *
 * The fallback here is the heuristic, and it is also the *default*: vision is
 * an opt-in capability that needs a model running somewhere. A fresh clone
 * still classifies photos, just less well.
 */
export function getAnalyzer(settings: VisionSettings): PhotoAnalyzer {
  if (settings.driver === "ollama") {
    return createOllamaAnalyzer({
      baseUrl: settings.baseUrl,
      model: settings.model,
    });
  }

  if (settings.driver === "openai") {
    return createOpenAiAnalyzer({
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: settings.apiKey,
    });
  }

  return heuristicAnalyzer;
}

/**
 * The analyzer that will actually serve, having checked it can.
 *
 * `isAvailable` is asked here rather than at the call site so a model that was
 * configured and then stopped degrades on the next photo instead of on every
 * photo — the caller never has to know which backend answered.
 */
export async function getUsableAnalyzer(
  settings: VisionSettings
): Promise<PhotoAnalyzer> {
  const analyzer = getAnalyzer(settings);
  return (await analyzer.isAvailable()) ? analyzer : heuristicAnalyzer;
}
