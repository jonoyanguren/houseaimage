import type { PropertyType, SceneType } from "@/types/video";

/**
 * Looking at a photograph and saying what it is.
 *
 * This is a different seam from `VideoProvider`, and the distinction matters:
 * a language model cannot render a clip, and a video model cannot tell a
 * kitchen from a bathroom. They are two capabilities, so they get two
 * interfaces.
 *
 * What hangs on it is the scene axis of the prompt — the thing that decides
 * whether the camera pans along a worktop or tilts up a mirror. Until now it
 * was guessed from the filename, which works for `cocina-2.jpg` and gives up
 * on `IMG_2481.jpg`.
 */

/** One photo, as small as it can usefully be. */
export interface AnalyzablePhoto {
  /** Downscaled JPEG data URL — the same thumbnail the grid already renders. */
  dataUrl: string;
  fileName: string;
  /** Position among the photos being added, for the positional fallback. */
  index: number;
  total: number;
  propertyType?: PropertyType;
}

export interface PhotoAnalysis {
  sceneType: SceneType;
  /**
   * True when this photo should probably not become a clip at all: a floor
   * plan, a screenshot, something blurred or too dark.
   *
   * Never acted on automatically. It is a warning next to the thumbnail and
   * the user decides — but it is where the money is, because every photo
   * dropped here is a render not paid for.
   */
  discard: boolean;
  /** Short, user-facing, only when `discard`. */
  reason?: string;
  /**
   * Which driver produced this.
   *
   * Surfaced deliberately: a guess from a model and a guess from a filename
   * deserve different amounts of trust, and the interface should not pretend
   * they are the same thing.
   */
  source: "vision" | "heuristic";
}

/**
 * A backend that can look at a photo.
 *
 * Implementations must never throw for an ordinary failure — a model that is
 * down, slow or talking nonsense costs us a better guess, not the batch. The
 * selection layer falls back to the heuristic and the flow continues.
 */
export interface PhotoAnalyzer {
  readonly name: string;
  /** False when the backend is not usable here: not running, no model set. */
  isAvailable(): Promise<boolean>;
  analyze(photo: AnalyzablePhoto): Promise<PhotoAnalysis>;
}

/** What the operator configures. Nothing here is secret for a local model. */
export interface VisionSettings {
  driver: "heuristic" | "ollama";
  /** Where the local server listens. */
  baseUrl?: string;
  /** Which model to ask. It has to be one that can actually see. */
  model?: string;
}

/** A model the local server has, and whether it is any use to us. */
export interface VisionModel {
  name: string;
  /** False for a text-only model, which is most of them. */
  vision: boolean;
  /** Bytes on disk, so the picker can show what it costs to keep. */
  size?: number;
}
