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

export interface ClipOptions {
  /** Provider motion/model preset id, e.g. "dop-1". */
  preset?: string;
  /** Text prompt guiding motion/style for every clip in the batch. */
  prompt?: string;
  /** Output aspect ratio, e.g. "9:16", "16:9", "1:1". */
  aspectRatio?: string;
  /** Requested clip length. Providers clamp this to their supported range. */
  durationSeconds?: number;
}

/** One photo's worth of work handed to a provider. */
export interface CreateClipInput {
  imageUrl: string;
  options?: ClipOptions;
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
  providerJobId: string;
  status: ClipStatus;
  progress?: number;
  videoUrl?: string;
  error?: string;
  simulated?: boolean;
  /** How many times this clip has been re-submitted after a failure. */
  attempts: number;
}

/** One entry of the assembled reel, with its position on the timeline. */
export interface ReelSegment {
  clipId: string;
  index: number;
  imageUrl: string;
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
  /** Publicly reachable image URLs, in the order they should appear. */
  imageUrls: string[];
  options?: ClipOptions;
}
