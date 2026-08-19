import type { AnalyzablePhoto, PhotoAnalysis, PhotoAnalyzer } from "@/types/vision";
import { classifyPhoto } from "@/lib/prompts/classify";

/**
 * The fallback, and the default.
 *
 * No model, no server, no configuration: the filename when it says something,
 * the position when it does not, and neutral when neither does. It is what the
 * app shipped with, and it is what every other driver degrades to.
 *
 * It never reports `discard`, because a filename cannot tell you a photo is a
 * floor plan — only a model that looks can.
 */
export const heuristicAnalyzer: PhotoAnalyzer = {
  name: "heuristic",

  async isAvailable() {
    return true;
  },

  async analyze(photo: AnalyzablePhoto): Promise<PhotoAnalysis> {
    return {
      sceneType: classifyPhoto({
        fileName: photo.fileName,
        index: photo.index,
        total: photo.total,
        propertyType: photo.propertyType,
      }),
      discard: false,
      source: "heuristic",
    };
  },
};
