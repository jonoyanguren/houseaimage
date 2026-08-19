import type {
  AnalyzablePhoto,
  PhotoAnalysis,
  PhotoAnalyzer,
  VisionModel,
} from "@/types/vision";
import { INSTRUCTION, RESPONSE_SCHEMA, readAnswer } from "@/lib/vision/prompt";
import { heuristicAnalyzer } from "@/lib/vision/heuristic";

/**
 * A local vision model, through Ollama.
 *
 * The point of running it locally is not the cost — classifying a dozen photos
 * is fractions of a cent anywhere. It is that **the photographs never leave
 * the building**. These are the insides of homes people live in, and an agency
 * being able to say they were never uploaded to a third party is worth more
 * than the few cents it saves.
 *
 * The price is a machine with a GPU, which rules out serverless. That is the
 * trade, and it is why this is one driver rather than the only one.
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";

/**
 * Generous on purpose, and the number was chosen by being wrong first.
 *
 * A warm model answers in one to three seconds. A **cold** one has to be read
 * off disk — eight or nine gigabytes for a current vision model — and the
 * first photo of the day was still waiting at sixty seconds. That timeout
 * turned an ordinary cold start into "the classifier does not work".
 *
 * It is a ceiling, not a target: crossing it costs the photo its guess, never
 * the batch. See `warmUp`, which is the real fix.
 */
const REQUEST_TIMEOUT_MS = 150_000;

/**
 * How long Ollama keeps the model in memory between photos.
 *
 * Without this it can be evicted between one photograph and the next, and the
 * batch pays the load twice. Twenty photos arrive over a couple of minutes, so
 * the window only has to outlast an upload.
 */
const KEEP_ALIVE = "20m";

function baseUrl(configured?: string): string {
  return (configured?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/**
 * What a model can do, cached per name.
 *
 * Worth asking rather than assuming: most models in a typical library are
 * text-only, and handing an image to one produces confident nonsense instead
 * of an error. The settings panel uses this to grey out the ones that cannot
 * see.
 */
const globalForOllama = globalThis as unknown as {
  __houseaimageOllamaCaps?: Map<string, string[]>;
};

const capabilities: Map<string, string[]> = (globalForOllama.__houseaimageOllamaCaps ??=
  new Map<string, string[]>());

async function describeModel(url: string, model: string): Promise<string[]> {
  const cached = capabilities.get(`${url}|${model}`);
  if (cached) return cached;

  const res = await fetch(`${url}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`Ollama no conoce el modelo "${model}"`);

  const data = (await res.json()) as { capabilities?: unknown };
  const caps = Array.isArray(data.capabilities)
    ? data.capabilities.map(String)
    : [];

  capabilities.set(`${url}|${model}`, caps);
  return caps;
}

/** Test seam, and the escape hatch when a model is pulled again. */
export function __resetModelCache() {
  capabilities.clear();
}

/**
 * Pull the model into memory ahead of time.
 *
 * Called when the operator saves the setting, so the cold load happens while
 * they are still in the settings panel rather than in front of the first
 * photograph. Fire and forget: nothing waits for it and nothing fails if it
 * does not work.
 */
export async function warmUp(config: { baseUrl?: string; model?: string }): Promise<void> {
  const model = config.model?.trim();
  if (!model) return;

  try {
    await fetch(`${baseUrl(config.baseUrl)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // No messages: Ollama loads the model and returns without generating.
      body: JSON.stringify({ model, messages: [], keep_alive: KEEP_ALIVE }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    /* The first photo will pay for the load instead. */
  }
}

/** Every model the local server holds, flagged by whether it can see. */
export async function listModels(configured?: string): Promise<VisionModel[]> {
  const url = baseUrl(configured);

  const res = await fetch(`${url}/api/tags`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Ollama respondió ${res.status}`);

  const data = (await res.json()) as {
    models?: { name?: string; size?: number }[];
  };

  const names = (data.models ?? [])
    .map((m) => m.name)
    .filter((name): name is string => typeof name === "string");

  // Asked one by one because `/api/tags` does not carry capabilities. The
  // answers are cached, so this is slow once and instant afterwards.
  return Promise.all(
    names.map(async (name) => {
      const size = (data.models ?? []).find((m) => m.name === name)?.size;
      try {
        return { name, size, vision: (await describeModel(url, name)).includes("vision") };
      } catch {
        return { name, size, vision: false };
      }
    })
  );
}

/** Strip the `data:image/jpeg;base64,` prefix — Ollama wants the payload alone. */
function toBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

export function createOllamaAnalyzer(config: {
  baseUrl?: string;
  model?: string;
}): PhotoAnalyzer {
  const url = baseUrl(config.baseUrl);
  const model = config.model?.trim() ?? "";

  return {
    name: "ollama",

    async isAvailable(): Promise<boolean> {
      if (!model) return false;

      try {
        // Both halves matter: the server has to answer, and the model has to
        // be one that can actually look at an image.
        return (await describeModel(url, model)).includes("vision");
      } catch {
        return false;
      }
    },

    async analyze(photo: AnalyzablePhoto): Promise<PhotoAnalysis> {
      // Computed first: it is the answer whenever the model has nothing better
      // to offer, including when it is wrong in a way we can detect.
      const fallback = await heuristicAnalyzer.analyze(photo);

      try {
        const caps = await describeModel(url, model);

        const res = await fetch(`${url}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            keep_alive: KEEP_ALIVE,
            // Schema-enforced output. Without it a chatty model wraps the JSON
            // in an apology and the parse becomes archaeology.
            format: RESPONSE_SCHEMA,
            // Classification is not a creative task; the same photo should
            // always land in the same room.
            options: { temperature: 0 },
            // Reasoning tokens are latency we are paying for nothing here, but
            // sending the flag to a model without the capability is an error.
            ...(caps.includes("thinking") ? { think: false } : {}),
            messages: [
              {
                role: "user",
                content: INSTRUCTION,
                images: [toBase64(photo.dataUrl)],
              },
            ],
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) return fallback;

        const data = (await res.json()) as { message?: { content?: string } };
        const content = data.message?.content?.trim();
        if (!content) return fallback;

        const { sceneType, discard, reason } = readAnswer(JSON.parse(content));

        // An abstention from the model is not better than the filename, which
        // may still carry a real name — so we keep the heuristic's answer and
        // only take the model's when it actually committed to something.
        if (sceneType === "generico" && !discard) return fallback;

        return { sceneType, discard, reason, source: "vision" };
      } catch {
        // Down, slow, or talking nonsense: a worse guess, never a failure.
        return fallback;
      }
    },
  };
}
