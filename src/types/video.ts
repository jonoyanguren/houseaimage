/**
 * Domain types for the clip-per-photo generation pipeline.
 *
 * The unit of work is a **clip**: one source photo in, one short video out.
 * Image-to-video models take a single starting frame and return a few seconds
 * of footage, so a listing with N photos becomes N provider jobs (a *batch*),
 * polled independently and assembled into a *reel* once they finish.
 */

/** Lifecycle of a single provider job. */
export type ClipStatus = "queued" | "processing" | "completed" | "failed";

/**
 * Aggregate state of a batch.
 * - `processing`: at least one clip is still queued/processing.
 * - `completed`: every clip finished successfully.
 * - `partial`: all clips settled, some succeeded and some failed. The reel is
 *   still built from the survivors so the user gets a usable video.
 * - `failed`: all clips settled and none succeeded.
 */
export type BatchStatus = "processing" | "completed" | "partial" | "failed";

/** Treatment applied to a whole reel. See `src/lib/prompts/styles.ts`. */
export type StyleId =
  | "cinematografico"
  | "dron"
  | "dinamico"
  | "tour"
  | "editorial"
  | "lifestyle";

/** Kind of property being marketed. See `src/lib/prompts/properties.ts`. */
export type PropertyType = "piso" | "casa" | "atico" | "rustico" | "obraNueva";

/** What a given photo shows. See `src/lib/prompts/scenes.ts`. */
export type SceneType =
  | "fachada"
  | "salon"
  | "cocina"
  | "dormitorio"
  | "bano"
  | "terraza"
  | "piscina"
  | "vistas"
  | "jardin"
  | "distribuidor"
  | "detalle"
  | "comunes"
  | "generico";

/**
 * A style preset. Spanish fields are shown to the user; `base`, `negative` and
 * `sceneOverrides` are sent to the model and stay in English.
 */
export interface StylePreset {
  id: StyleId;
  label: string;
  tagline: string;
  bestFor: readonly string[];
  aspectRatio: string;
  durationSeconds: number;
  base: string;
  negative: string;
  /** Style-specific replacement for a scene's default motion. */
  sceneOverrides?: Partial<Record<SceneType, string>>;
}

/**
 * A property profile. `context` is sent to the model; the rest drives what the
 * UI offers and in what order.
 */
export interface PropertyProfile {
  id: PropertyType;
  label: string;
  hint: string;
  context: string;
  /** Styles that suit this property, best first. */
  recommendedStyles: readonly StyleId[];
  /** Scenes worth surfacing first. Never a whitelist — nothing is hidden. */
  primaryScenes: readonly SceneType[];
}

/** A scene profile: what the photo shows and how the camera should move. */
export interface SceneProfile {
  id: SceneType;
  label: string;
  hint: string;
  /** Position in the recommended viewing order; lower comes first. */
  order: number;
  motion: string;
}

/** Output of the prompt resolver, ready to hand to a provider. */
export interface ResolvedPrompt {
  prompt: string;
  negative: string;
  styleId: StyleId;
  sceneType: SceneType;
  propertyType: PropertyType;
  aspectRatio: string;
  durationSeconds: number;
}

export interface ClipOptions {
  /** Provider motion/model preset id, e.g. "dop-1". */
  preset?: string;
  /** Chosen style. Falls back to the default preset when absent or unknown. */
  styleId?: StyleId;
  /** Kind of property, which contextualises every clip in the batch. */
  propertyType?: PropertyType;
  /** Free-text nuance from the user, folded into every clip's prompt. */
  prompt?: string;
  /** Overrides the style's aspect ratio when set. */
  aspectRatio?: string;
  /** Overrides the style's clip length when set. */
  durationSeconds?: number;
}

/** One photo's worth of work handed to a provider. */
export interface CreateClipInput {
  imageUrl: string;
  /** Fully resolved prompt — providers never build prompts themselves. */
  resolved: ResolvedPrompt;
  options?: ClipOptions;
}

/** A photo as submitted by the client, with its scene classification. */
export interface PhotoInput {
  imageUrl: string;
  sceneType?: SceneType;
}

export interface ProviderClipJob {
  /** Opaque id returned by the provider; only meaningful to that provider. */
  providerJobId: string;
  status: ClipStatus;
}

export interface ProviderClipStatus extends ProviderClipJob {
  /** 0-100 when the provider reports it. */
  progress?: number;
  videoUrl?: string;
  error?: string;
  /**
   * True when the clip was produced by the simulated provider, so the UI can
   * label it instead of pretending a real render happened.
   */
  simulated?: boolean;
}

/**
 * A video backend. Implementations must be stateless — everything we need to
 * resume polling after a restart lives in the job store, not in the provider.
 */
export interface VideoProvider {
  readonly name: string;
  /** Enqueue one photo. Must reject rather than silently degrade. */
  createClipJob(input: CreateClipInput): Promise<ProviderClipJob>;
  /** Read current state of a previously created job. */
  getClipJobStatus(providerJobId: string): Promise<ProviderClipStatus>;
}

/** A clip as tracked by us, joining provider state to our own ordering. */
export interface Clip {
  clipId: string;
  /** Position in the final reel — the order the user arranged the photos in. */
  index: number;
  imageUrl: string;
  /** What this photo shows, driving its camera movement. */
  sceneType: SceneType;
  providerJobId: string;
  status: ClipStatus;
  progress?: number;
  videoUrl?: string;
  error?: string;
  simulated?: boolean;
  /** How many times this clip has been re-submitted after a failure. */
  attempts: number;
  /**
   * When the current provider job was created, reset on every retry. Drives
   * both the stuck-job timeout and the wait between attempts.
   */
  submittedAt: number;
}

/** One entry of the assembled reel, with its position on the timeline. */
export interface ReelSegment {
  clipId: string;
  index: number;
  imageUrl: string;
  sceneType: SceneType;
  videoUrl?: string;
  simulated?: boolean;
  durationSeconds: number;
  /** Seconds from the start of the reel at which this segment begins. */
  startAtSeconds: number;
}

/** The montage: ordered, playable result built from the completed clips. */
export interface Reel {
  /** Which composition strategy produced this reel. */
  strategy: "sequential-playlist" | "server-side-stitch";
  segments: ReelSegment[];
  totalDurationSeconds: number;
  /**
   * Set only by a stitching strategy that produces a single downloadable file.
   * The default playlist strategy leaves this undefined and the client plays
   * the segments back to back.
   */
  url?: string;
}

export interface Batch {
  batchId: string;
  status: BatchStatus;
  createdAt: number;
  updatedAt: number;
  options?: ClipOptions;
  clips: Clip[];
  /** Present once every clip has settled and at least one succeeded. */
  reel?: Reel;
}

/** Request body of `POST /api/generate`. */
export interface CreateBatchRequest {
  /** Publicly reachable photos, in the order they should appear. */
  photos: PhotoInput[];
  options?: ClipOptions;
}
