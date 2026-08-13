import type {
  ProviderClipJob,
  ProviderClipStatus,
  VideoProvider,
} from "@/types/video";

/**
 * Simulated provider — the default when no API key is configured, so the app
 * runs end to end straight after `npm install` with an empty `.env`.
 *
 * It renders nothing. Clips settle as `completed` with no `videoUrl` and
 * `simulated: true`, and the UI shows the source photo with a slow pan in
 * place of footage. That keeps the fan-out, polling, retry and montage paths
 * fully exercised without ever implying a real render happened.
 *
 * Like every provider it is stateless: the job id carries the timing, so
 * status is a pure function of the id and the current clock and survives a
 * dev-server restart.
 */

/** Wall-clock time a simulated render "takes", before per-job jitter. */
const SIMULATED_RENDER_MS = 6_000;

/**
 * Fraction of simulated jobs that fail, as a 0-1 value. Defaults to 0. Set
 * `MOCK_FAILURE_RATE=0.3` to exercise the retry and partial-reel paths.
 */
function failureRate(): number {
  const parsed = Number.parseFloat(process.env.MOCK_FAILURE_RATE ?? "");
  if (Number.isNaN(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 1);
}

/** Cheap deterministic hash so a given job id always behaves the same way. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

interface ParsedJobId {
  createdAt: number;
  durationMs: number;
  seed: string;
}

function parseJobId(providerJobId: string): ParsedJobId | null {
  const [prefix, createdAt, durationMs, seed] = providerJobId.split(":");
  if (prefix !== "mock" || !seed) return null;

  const parsedCreatedAt = Number.parseInt(createdAt, 10);
  const parsedDuration = Number.parseInt(durationMs, 10);
  if (Number.isNaN(parsedCreatedAt) || Number.isNaN(parsedDuration)) return null;

  return { createdAt: parsedCreatedAt, durationMs: parsedDuration, seed };
}

export const mockProvider: VideoProvider = {
  name: "mock",

  // The input is deliberately ignored: nothing is rendered, so the photo and
  // options make no difference to the simulated outcome.
  async createClipJob(): Promise<ProviderClipJob> {
    const seed = crypto.randomUUID().slice(0, 8);
    // Jitter each job so clips finish at different times, the way real ones do
    // — a batch that completes all at once hides ordering bugs in the UI.
    const durationMs = Math.round(SIMULATED_RENDER_MS * (0.6 + hash(seed) * 0.8));

    return {
      providerJobId: `mock:${Date.now()}:${durationMs}:${seed}`,
      status: "queued",
    };
  },

  async getClipJobStatus(providerJobId: string): Promise<ProviderClipStatus> {
    const parsed = parseJobId(providerJobId);
    if (!parsed) {
      return {
        providerJobId,
        status: "failed",
        error: `Not a simulated job id: ${providerJobId}`,
      };
    }

    const elapsed = Date.now() - parsed.createdAt;

    if (elapsed >= parsed.durationMs) {
      // Failure is decided from the seed, so a job that failed stays failed
      // across polls — but a *retry* mints a new seed and can succeed.
      if (hash(`fail:${parsed.seed}`) < failureRate()) {
        return {
          providerJobId,
          status: "failed",
          error: "Simulated render failure (MOCK_FAILURE_RATE)",
          simulated: true,
        };
      }

      return { providerJobId, status: "completed", progress: 100, simulated: true };
    }

    const progress = Math.round((elapsed / parsed.durationMs) * 100);

    // A short queued phase up front, so the UI's queued state is reachable.
    if (elapsed < parsed.durationMs * 0.15) {
      return { providerJobId, status: "queued", progress, simulated: true };
    }

    return { providerJobId, status: "processing", progress, simulated: true };
  },
};
