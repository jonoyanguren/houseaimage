import type {
  GenerateVideoInput,
  GenerateVideoJob,
  GenerateVideoJobStatus,
} from "@/types/higgsfield";

/**
 * Thin client around the Higgsfield API.
 *
 * The exact endpoint paths and payload shape below are a best-effort
 * placeholder — confirm them against your Higgsfield account's API docs
 * (https://docs.higgsfield.ai or the API reference in your dashboard) and
 * adjust `createVideoJob` / `getVideoJobStatus` accordingly before shipping.
 */

const API_BASE_URL = process.env.HIGGSFIELD_API_BASE_URL ?? "https://api.higgsfield.ai/v1";
const API_KEY = process.env.HIGGSFIELD_API_KEY;

function assertConfigured() {
  if (!API_KEY) {
    throw new Error(
      "HIGGSFIELD_API_KEY is not set. Add it to .env.local (see .env.example)."
    );
  }
}

async function higgsfieldFetch(path: string, init: RequestInit) {
  assertConfigured();

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...init.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Higgsfield API error ${res.status}: ${body}`);
  }

  return res.json();
}

export async function createVideoJob(
  input: GenerateVideoInput
): Promise<GenerateVideoJob> {
  const data = await higgsfieldFetch("/videos/generate", {
    method: "POST",
    body: JSON.stringify({
      images: input.imageUrls,
      preset: input.options?.preset ?? "dop-1",
      prompt: input.options?.prompt,
      aspect_ratio: input.options?.aspectRatio ?? "9:16",
    }),
  });

  return {
    jobId: data.id ?? data.job_id,
    status: data.status ?? "queued",
  };
}

export async function getVideoJobStatus(
  jobId: string
): Promise<GenerateVideoJobStatus> {
  const data = await higgsfieldFetch(`/videos/generate/${jobId}`, {
    method: "GET",
  });

  return {
    jobId,
    status: data.status,
    progress: data.progress,
    videoUrl: data.video_url ?? data.output?.url,
    error: data.error,
  };
}
