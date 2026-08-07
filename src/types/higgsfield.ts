export type GenerationStatus = "queued" | "processing" | "completed" | "failed";

export interface GenerateVideoOptions {
  /** Higgsfield motion/model preset id, e.g. "dop-1", "soul-1". Confirm valid values in the Higgsfield dashboard/docs. */
  preset?: string;
  /** Optional text prompt guiding motion/style. */
  prompt?: string;
  /** Output aspect ratio, e.g. "9:16", "16:9", "1:1". */
  aspectRatio?: string;
}

export interface GenerateVideoInput {
  /** Publicly reachable image URLs, in the order they should appear in the video. */
  imageUrls: string[];
  options?: GenerateVideoOptions;
}

export interface GenerateVideoJob {
  jobId: string;
  status: GenerationStatus;
}

export interface GenerateVideoJobStatus extends GenerateVideoJob {
  progress?: number;
  videoUrl?: string;
  error?: string;
}
