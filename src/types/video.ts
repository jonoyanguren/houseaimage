import type { ProviderVerification } from "@/types/settings";

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
 * Why a clip failed, classified so the engine can decide whether retrying is
 * worth anything.
 *
 * This distinction is money: re-submitting a photo the provider rejected for
 * being an unsupported format costs the same as re-submitting one that hit a
 * rate limit, and only the second one can ever succeed. Treating every failure
 * the same burns attempts — and the customer's credits — on work that is
 * guaranteed to fail again.
 */
export type FailureKind =
  /** Provider is throttling us. Transient, and deserves a longer wait. */
  | "rate_limited"
  /** Provider broke on its side (5xx). Transient. */
  | "provider_error"
  /** We could not reach the provider at all. Transient. */
  | "network"
  /** The job never finished in time. Transient. */
  | "timeout"
  /** The provider rejected the input (4xx). Permanent — never retry. */
  | "invalid_input"
  /** Bad or missing credentials. Permanent, and a configuration problem. */
  | "unauthorized"
  /** Unclassified. Treated as transient, because giving up costs more. */
  | "unknown";

export interface ClipFailure {
  kind: FailureKind;
  /** Human-readable, safe to show the user. */
  message: string;
  /** Provider HTTP status, when there was one. */
  status?: number;
  at: number;
}

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
  /** Set when `status` is `failed`. The provider classifies its own errors. */
  failure?: ClipFailure;
  /**
   * True when the clip was produced by the simulated provider, so the UI can
   * label it instead of pretending a real render happened.
   */
  simulated?: boolean;
}

/**
 * A model a backend can render with.
 *
 * Catalogues move — models are added, renamed and retired — so this is fetched
 * from the provider rather than written down here. What we keep is only what a
 * chooser needs plus the two constraints that can make a render fail: which
 * durations it accepts and which frames it can produce.
 */
export interface VideoModelInfo {
  id: string;
  label: string;
  description?: string;
  /** Who actually made the model, which is not always the backend. */
  vendor?: string;
  /** Discrete lengths, when the model lists them. */
  durations?: number[];
  /** A continuous range, when it gives one instead. */
  minSeconds?: number;
  maxSeconds?: number;
  aspectRatios?: string[];
  tags?: string[];
}

/** What a batch would cost, before committing to it. */
export interface CostQuery {
  aspectRatio: string;
  durationSeconds: number;
  /** How many clips the batch will contain — one per photograph. */
  clips: number;
}

export interface CostEstimate {
  /** In the backend's own units. Credits, for Higgsfield. */
  perClip: number;
  total: number;
  /**
   * Set when the backend refused something and used another value: a duration
   * the model does not accept, most often. Shown, because a silent adjustment
   * is how someone ends up with four-second clips they did not ask for.
   */
  note?: string;
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
  /**
   * Optional: check the stored credentials without creating a job, so the
   * settings panel can tell an operator a key is wrong before a batch does.
   * Providers that need no credentials simply omit it.
   */
  verifyCredentials?(): Promise<ProviderVerification>;
  /**
   * Optional: the models this backend can render with, so the operator picks
   * from what exists today instead of typing an id from a blog post.
   */
  listModels?(): Promise<VideoModelInfo[]>;
  /**
   * Optional: what a batch would cost, asked before it is submitted.
   *
   * The whole point is that it is answered by the backend rather than
   * calculated here: only it knows what a resolution or an extra second does
   * to the price.
   */
  estimateCost?(query: CostQuery): Promise<CostEstimate>;
  /** Optional: what the account has left to spend. */
  getBalance?(): Promise<number | undefined>;
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
  /** Set while `status` is `failed`, cleared when a retry re-queues the clip. */
  failure?: ClipFailure;
  simulated?: boolean;
  /**
   * The exact prompt this clip was rendered with.
   *
   * Kept so a render is reproducible and debuggable — "what did we actually
   * ask for?" is the first question when a clip comes out wrong. Stripped
   * before the batch leaves the API (see `toPublicBatch`); the prompt craft is
   * the product and has no business in the browser.
   */
  resolved: ResolvedPrompt;
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
   * The reel's frame, from the chosen style.
   *
   * Carried on the reel rather than looked up again by whoever plays it: the
   * player was hard-coded to 16:9, so a 9:16 social reel — half the catalogue
   * — was cropped top and bottom in its own preview.
   */
  aspectRatio: string;
  /**
   * The finished, downloadable file — the thing the customer actually buys and
   * sends on WhatsApp or uploads to a portal. Undefined while only the
   * playlist exists.
   */
  url?: string;
  /** True while the server is assembling that file. */
  stitching?: boolean;
  /**
   * Set when assembly failed. Not fatal: the playlist still plays, so the user
   * keeps a watchable reel and only loses the download.
   */
  stitchError?: string;
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

/**
 * What a batch looks like once it leaves the API.
 *
 * The internal `Batch` is the engine's own model and carries things the
 * browser must not see — above all `clip.resolved`, the composed prompt. Until
 * this projection existed the API response *was* the internal model, so any
 * field added to the engine leaked straight to the client. Everything that
 * goes out passes through `toPublicBatch`.
 */
export type PublicClip = Omit<Clip, "resolved" | "providerJobId" | "failure"> & {
  /** Flattened so the UI has one thing to render, not a shape to interpret. */
  error?: string;
  /** Whether the engine will try this clip again on its own. */
  willRetry: boolean;
};

export type PublicBatch = Omit<Batch, "clips" | "options"> & {
  clips: PublicClip[];
  /** Only the parts of the options the UI actually needs back. */
  styleId?: StyleId;
  propertyType?: PropertyType;
};

/** Request body of `POST /api/generate`. */
export interface CreateBatchRequest {
  /** Publicly reachable photos, in the order they should appear. */
  photos: PhotoInput[];
  options?: ClipOptions;
}
