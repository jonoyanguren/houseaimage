import type {
  CreateClipInput,
  ProviderClipJob,
  ProviderClipStatus,
  VideoProvider,
} from "@/types/video";
import { DEFAULT_CLIP_SECONDS } from "@/lib/config";

/**
 * Higgsfield image-to-video provider: one photo in, one short clip out.
 *
 * The endpoint paths and payload field names below are a best-effort
 * placeholder — confirm them against your account's API reference
 * (https://docs.higgsfield.ai or the dashboard) and adjust the two `fetch`
 * calls. Everything outside this file is provider-agnostic, so a corrected
 * payload shape stays a one-file change.
 */

const API_BASE_URL =
  process.env.HIGGSFIELD_API_BASE_URL ?? "https://api.higgsfield.ai/v1";

/** Abort a provider call rather than hanging a request handler indefinitely. */
const REQUEST_TIMEOUT_MS = 30_000;

function apiKey(): string {
  const key = process.env.HIGGSFIELD_API_KEY;
  if (!key) {
    throw new Error(
      "HIGGSFIELD_API_KEY is not set. Add it to .env.local (see .env.example), " +
        "or unset VIDEO_PROVIDER to fall back to the simulated provider."
    );
  }
  return key;
}

async function higgsfieldFetch(path: string, init: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Higgsfield API error ${res.status}: ${body.slice(0, 500)}`);
  }

  return res.json();
}

/**
 * Map a provider's status vocabulary onto ours. Providers add states over
 * time, so anything unrecognised is treated as still-running rather than
 * mistaken for a terminal state — a clip that is wrongly marked failed can
 * never recover, whereas one wrongly marked processing self-corrects.
 */
function normalizeStatus(raw: unknown): ProviderClipStatus["status"] {
  const value = String(raw ?? "").toLowerCase();

  if (["completed", "succeeded", "success", "done", "finished"].includes(value)) {
    return "completed";
  }
  if (["failed", "error", "canceled", "cancelled", "rejected"].includes(value)) {
    return "failed";
  }
  if (["queued", "pending", "created", "waiting"].includes(value)) {
    return "queued";
  }
  return "processing";
}

export const higgsfieldProvider: VideoProvider = {
  name: "higgsfield",

  async createClipJob(input: CreateClipInput): Promise<ProviderClipJob> {
    const data = await higgsfieldFetch("/videos/generate", {
      method: "POST",
      body: JSON.stringify({
        // One starting frame per job — this is the whole point of the fan-out.
        image: input.imageUrl,
        preset: input.options?.preset ?? "dop-1",
        prompt: input.options?.prompt,
        aspect_ratio: input.options?.aspectRatio ?? "9:16",
        duration: input.options?.durationSeconds ?? DEFAULT_CLIP_SECONDS,
      }),
    });

    const providerJobId = data.id ?? data.job_id;
    if (!providerJobId) {
      throw new Error("Higgsfield response did not include a job id");
    }

    return { providerJobId, status: normalizeStatus(data.status ?? "queued") };
  },

  async getClipJobStatus(providerJobId: string): Promise<ProviderClipStatus> {
    const data = await higgsfieldFetch(`/videos/generate/${providerJobId}`, {
      method: "GET",
    });

    const reported = normalizeStatus(data.status);
    const videoUrl = data.video_url ?? data.output?.url;

    // A "completed" job with no URL is a provider contract violation. Treat it
    // as a failure so the clip becomes retryable, rather than letting a
    // successful-looking clip leave a silent gap in the reel.
    const missingUrl = reported === "completed" && !videoUrl;
    const status = missingUrl ? "failed" : reported;

    return {
      providerJobId,
      status,
      progress: typeof data.progress === "number" ? data.progress : undefined,
      videoUrl,
      error:
        data.error ??
        (missingUrl
          ? "Higgsfield reported the job as completed but returned no video URL"
          : undefined),
    };
  },
};
