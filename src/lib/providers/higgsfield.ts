import type {
  CreateClipInput,
  ProviderClipJob,
  ProviderClipStatus,
  VideoProvider,
} from "@/types/video";
import type { ProviderVerification } from "@/types/settings";
import type { PluginConfig, ProviderPlugin } from "@/types/plugin";
import { DEFAULT_CLIP_SECONDS } from "@/lib/config";
import { ProviderError, kindFromStatus } from "@/lib/providers/errors";
import { normalizeStatus } from "@/lib/providers/status";

/**
 * Higgsfield image-to-video provider: one photo in, one short clip out.
 *
 * The endpoint paths and payload field names below are a best-effort
 * placeholder — confirm them against your account's API reference
 * (https://docs.higgsfield.ai or the dashboard) and adjust the two `fetch`
 * calls. Everything outside this file is provider-agnostic, so a corrected
 * payload shape stays a one-file change.
 */

const DEFAULT_BASE_URL = "https://api.higgsfield.ai/v1";

/** Abort a provider call rather than hanging a request handler indefinitely. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Credentials arrive as plugin configuration rather than being read from the
 * environment here, so the same code serves a key typed into the settings
 * panel and one set in `.env`. Which of the two wins is decided once, in
 * `src/lib/settings`.
 */
function credentials(config: PluginConfig): { apiKey: string; baseUrl: string } {
  const apiKey = config.apiKey?.trim();

  if (!apiKey) {
    // Permanent by construction: no amount of retrying conjures a key.
    throw new ProviderError(
      "unauthorized",
      "No hay ninguna clave de Higgsfield configurada. Conéctala en Ajustes, " +
        "o define HIGGSFIELD_API_KEY en .env.local (ver .env.example)."
    );
  }

  return {
    apiKey,
    baseUrl: config.baseUrl?.trim().replace(/\/+$/, "") || DEFAULT_BASE_URL,
  };
}

async function higgsfieldFetch(config: PluginConfig, path: string, init: RequestInit) {
  const { apiKey, baseUrl } = credentials(config);

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Classified here because only this module knows what these codes mean.
    // A 4xx is the provider rejecting the photo and will never succeed; a 429
    // or a 5xx is worth coming back to.
    throw new ProviderError(
      kindFromStatus(res.status),
      `Higgsfield API error ${res.status}: ${body.slice(0, 500)}`,
      res.status
    );
  }

  return res.json();
}

function createProvider(config: PluginConfig): VideoProvider {
  return {
    name: "higgsfield",

  /**
   * Check a key without spending anything.
   *
   * The distinction between `ok` and `verified` is the honest part: the
   * endpoint paths in this file are a placeholder, so a 404 means "we could
   * not check", not "the key is bad". Only an explicit 401/403 is treated as a
   * rejected key — refusing to save a working key because our probe URL is
   * wrong would be worse than saving an unverified one.
   */
  async verifyCredentials(): Promise<ProviderVerification> {
    const { apiKey, baseUrl } = credentials(config);

    try {
      const res = await fetch(`${baseUrl}/me`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          verified: true,
          message: "Higgsfield rechazó la clave (no autorizado).",
        };
      }

      if (res.ok) {
        return { ok: true, verified: true, message: "Conectado con Higgsfield." };
      }

      return {
        ok: true,
        verified: false,
        message:
          `La clave se ha guardado, pero no se pudo comprobar: Higgsfield respondió ${res.status} ` +
          "al endpoint de verificación. Confirma la URL base en la referencia de tu cuenta.",
      };
    } catch {
      return {
        ok: true,
        verified: false,
        message:
          "La clave se ha guardado, pero no se pudo contactar con Higgsfield para comprobarla.",
      };
    }
  },

  async createClipJob(input: CreateClipInput): Promise<ProviderClipJob> {
    const { resolved, options } = input;

    const data = await higgsfieldFetch(config, "/videos/generate", {
      method: "POST",
      body: JSON.stringify({
        // One starting frame per job — this is the whole point of the fan-out.
        image: input.imageUrl,
        preset: options?.preset ?? "dop-1",
        // Already composed from style + scene + user input by
        // `src/lib/prompts`. Providers never build prompts themselves.
        prompt: resolved.prompt,
        // Sent as a dedicated field: models honour a real negative prompt far
        // better than "no X" folded into the positive one.
        negative_prompt: resolved.negative,
        // An explicit override wins; otherwise the style decides.
        aspect_ratio: options?.aspectRatio ?? resolved.aspectRatio,
        duration:
          options?.durationSeconds ?? resolved.durationSeconds ?? DEFAULT_CLIP_SECONDS,
      }),
    });

    const providerJobId = data.id ?? data.job_id;
    if (!providerJobId) {
      throw new Error("Higgsfield response did not include a job id");
    }

    return { providerJobId, status: normalizeStatus(data.status ?? "queued") };
  },

  async getClipJobStatus(providerJobId: string): Promise<ProviderClipStatus> {
    const data = await higgsfieldFetch(config, `/videos/generate/${providerJobId}`, {
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
      failure:
        status === "failed"
          ? {
              // A render that failed on the provider's side, or a broken
              // contract — both worth one more go.
              kind: "provider_error",
              message:
                data.error ??
                (missingUrl
                  ? "Higgsfield dio el clip por terminado pero no devolvió vídeo"
                  : "La generación falló en el proveedor"),
              at: Date.now(),
            }
          : undefined,
    };
  },
};
}

export const higgsfieldApiPlugin: ProviderPlugin = {
  id: "higgsfield-api",
  label: "Higgsfield · API",
  description: "La API REST de Higgsfield con una clave de tu cuenta. La vía directa.",
  transport: "api",
  fields: [
    {
      name: "apiKey",
      label: "Clave de API",
      kind: "secret",
      required: true,
      placeholder: "hf_···",
    },
    {
      name: "baseUrl",
      label: "URL base",
      hint: "Déjala vacía para usar la de por defecto.",
      kind: "url",
      fallback: DEFAULT_BASE_URL,
      placeholder: DEFAULT_BASE_URL,
    },
  ],
  // See the note at the top of this file.
  needsPublicPhotos: true,
  create: createProvider,
  isConfigured: (config) => Boolean(config.apiKey?.trim()),
};
