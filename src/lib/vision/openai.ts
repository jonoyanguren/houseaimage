import type {
  AnalyzablePhoto,
  PhotoAnalysis,
  PhotoAnalyzer,
} from "@/types/vision";
import { INSTRUCTION, RESPONSE_SCHEMA, readAnswer } from "@/lib/vision/prompt";
import { heuristicAnalyzer } from "@/lib/vision/heuristic";

/**
 * A hosted vision model, through the OpenAI chat-completions dialect.
 *
 * One module for a dozen vendors — DeepSeek, Groq, OpenRouter, Together,
 * Fireworks, Gemini's compatible endpoint, a vLLM you run yourself — because
 * they all speak the same shape. Only the base URL, the model name and the key
 * differ, and all three are settings.
 *
 * That is the point, and it is a direct answer to how this market behaves:
 * prices move month to month, so the cheapest option today is a bad thing to
 * put in an architecture. Here the price is a dropdown.
 *
 * It exists because the local driver ties the product to a machine with a GPU.
 * The day this is deployed anywhere serverless or rented cheaply, Ollama stays
 * behind and this is what carries on classifying.
 */

/** A hosted model has no business taking longer than this on one photograph. */
const REQUEST_TIMEOUT_MS = 45_000;

export function createOpenAiAnalyzer(config: {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}): PhotoAnalyzer {
  const baseUrl = (config.baseUrl?.trim() || "https://api.openai.com/v1").replace(
    /\/+$/,
    ""
  );
  const model = config.model?.trim() ?? "";
  const apiKey = config.apiKey?.trim() ?? "";

  return {
    name: "openai",

    async isAvailable(): Promise<boolean> {
      // No round trip: a hosted classifier that is merely half-configured must
      // not cost a request per photograph to discover it.
      return Boolean(model && apiKey);
    },

    async analyze(photo: AnalyzablePhoto): Promise<PhotoAnalysis> {
      // The answer whenever the model has nothing better to offer.
      const fallback = await heuristicAnalyzer.analyze(photo);

      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            // Classification is not creative: the same photograph should
            // always land in the same room.
            temperature: 0,
            // Twenty tokens of JSON. Capping it stops a chatty model from
            // billing for an essay nobody reads.
            max_tokens: 200,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: INSTRUCTION },
                  // A data URL rather than a link: the photograph may well not
                  // be reachable from the vendor's network, and this is the
                  // same 640px thumbnail the grid already holds.
                  { type: "image_url", image_url: { url: photo.dataUrl } },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) return fallback;

        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };

        const content = data.choices?.[0]?.message?.content?.trim();
        if (!content) return fallback;

        const { sceneType, discard, reason } = readAnswer(JSON.parse(content));

        // An abstention is not better than a filename that may carry a real
        // room name, so the heuristic keeps its answer.
        if (sceneType === "generico" && !discard) return fallback;

        return { sceneType, discard, reason, source: "vision" };
      } catch {
        // Down, slow, rate-limited or talking prose: a worse guess, never a
        // failed upload.
        return fallback;
      }
    },
  };
}

/** Kept beside the driver so both halves of the request agree on the schema. */
export const OPENAI_RESPONSE_SCHEMA = RESPONSE_SCHEMA;
