import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  CreateClipInput,
  ProviderClipJob,
  ProviderClipStatus,
  VideoProvider,
} from "@/types/video";
import type { PluginConfig, ProviderPlugin } from "@/types/plugin";
import type { ProviderVerification } from "@/types/settings";
import { ProviderError } from "@/lib/providers/errors";
import { normalizeStatus } from "@/lib/providers/status";
import { commandsAllowed } from "@/lib/mcp/client";
import { splitArgs } from "@/lib/providers/args";
import { DEFAULT_CLIP_SECONDS } from "@/lib/config";

const run = promisify(execFile);

/**
 * A command line as a video backend.
 *
 * Deliberately **not** tied to one vendor's CLI. Every vendor's flags are
 * different and they change, so hard-coding one would be a guess with a
 * shelf life. Instead this defines a two-verb contract and lets the operator
 * point it at any binary — a vendor CLI wrapped in ten lines of shell, or a
 * script of their own:
 *
 *   $ <command> create        # JSON on stdin  → {"id":"…","status":"queued"}
 *   $ <command> status <id>   #                → {"status":"completed","videoUrl":"…"}
 *
 * The JSON handed to `create` is exactly what the engine resolved:
 *
 *   { imageUrl, prompt, negativePrompt, aspectRatio, durationSeconds }
 *
 * ⚠️ This runs a process on the server with whatever the settings panel says.
 * That is arbitrary code execution by anyone past the access gate, so it is
 * refused unless the host sets `ENGINE_ALLOW_COMMANDS=1`. Never remove that
 * check to make a deployment easier.
 */

/** Long enough for a slow launch, short enough not to pin a request. */
const CALL_TIMEOUT_MS = 60_000;

function parts(config: PluginConfig): { command: string; baseArgs: string[] } {
  const command = config.command?.trim();

  if (!command) {
    throw new ProviderError(
      "unauthorized",
      "El plugin de línea de comandos no tiene ningún comando configurado."
    );
  }

  if (!commandsAllowed()) {
    throw new ProviderError(
      "unauthorized",
      "Ejecutar comandos está desactivado en este servidor. Pon ENGINE_ALLOW_COMMANDS=1 " +
        "si de verdad quieres que esta aplicación lance procesos."
    );
  }

  return { command, baseArgs: splitArgs(config.args) };
}

/**
 * Run the binary and read its stdout as JSON.
 *
 * `execFile` and never a shell: the command comes from configuration, and a
 * shell would turn every argument into an injection point.
 */
async function invoke(
  config: PluginConfig,
  args: string[],
  input?: unknown
): Promise<Record<string, unknown>> {
  const { command, baseArgs } = parts(config);

  try {
    const child = run(command, [...baseArgs, ...args], {
      timeout: CALL_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    });

    if (input !== undefined) {
      child.child.stdin?.end(JSON.stringify(input));
    }

    const { stdout } = await child;
    const trimmed = stdout.trim();

    if (!trimmed) {
      throw new ProviderError("provider_error", `"${command}" no devolvió nada`);
    }

    // Tolerate a binary that logs before answering: the payload is the last
    // line that parses as JSON.
    const lines = trimmed.split("\n").reverse();
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line.trim());
        if (parsed && typeof parsed === "object") {
          return parsed as Record<string, unknown>;
        }
      } catch {
        /* Not this line. */
      }
    }

    throw new ProviderError(
      "provider_error",
      `"${command}" no devolvió JSON: ${trimmed.slice(0, 200)}`
    );
  } catch (err) {
    if (err instanceof ProviderError) throw err;

    const detail = err as { stderr?: string; message?: string; code?: string };
    const message = detail.stderr?.trim() || detail.message || "Fallo al ejecutar";

    // A missing binary is a configuration problem: no retry will conjure it.
    const kind = detail.code === "ENOENT" ? "invalid_input" : "provider_error";
    throw new ProviderError(kind, `${command}: ${message.slice(0, 300)}`);
  }
}

function createProvider(config: PluginConfig): VideoProvider {
  return {
    name: "higgsfield-cli",

    async verifyCredentials(): Promise<ProviderVerification> {
      if (!commandsAllowed()) {
        return {
          ok: false,
          verified: true,
          message:
            "Ejecutar comandos está desactivado. Pon ENGINE_ALLOW_COMMANDS=1 en el servidor.",
        };
      }

      try {
        // The contract's own health check. A binary that cannot answer this
        // cannot answer anything else either.
        const payload = await invoke(config, ["status", "check"]);
        return {
          ok: true,
          verified: true,
          message: `El comando responde (${normalizeStatus(payload.status)}).`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        return {
          // Saved but unproven: a wrapper may legitimately refuse a fake id,
          // and refusing to save over that would be worse than the doubt.
          ok: true,
          verified: false,
          message: `Guardado, pero la comprobación falló: ${message}`,
        };
      }
    },

    async createClipJob(input: CreateClipInput): Promise<ProviderClipJob> {
      const { resolved, options } = input;

      const payload = await invoke(config, ["create"], {
        imageUrl: input.imageUrl,
        prompt: resolved.prompt,
        negativePrompt: resolved.negative,
        aspectRatio: options?.aspectRatio ?? resolved.aspectRatio,
        durationSeconds:
          options?.durationSeconds ?? resolved.durationSeconds ?? DEFAULT_CLIP_SECONDS,
      });

      const id = payload.id ?? payload.jobId ?? payload.job_id;
      if (typeof id !== "string" || !id) {
        throw new ProviderError(
          "provider_error",
          "El comando no devolvió un identificador de trabajo"
        );
      }

      return { providerJobId: id, status: normalizeStatus(payload.status ?? "queued") };
    },

    async getClipJobStatus(providerJobId: string): Promise<ProviderClipStatus> {
      const payload = await invoke(config, ["status", providerJobId]);

      const reported = normalizeStatus(payload.status);
      const raw = payload.videoUrl ?? payload.video_url ?? payload.url;
      const videoUrl = typeof raw === "string" && raw ? raw : undefined;

      // Same rule as every other transport: finished with no file is a
      // failure, so the clip stays retryable instead of leaving a gap.
      const missingUrl = reported === "completed" && !videoUrl;
      const status = missingUrl ? "failed" : reported;

      return {
        providerJobId,
        status,
        progress: typeof payload.progress === "number" ? payload.progress : undefined,
        videoUrl,
        failure:
          status === "failed"
            ? {
                kind: "provider_error",
                message:
                  typeof payload.error === "string" && payload.error
                    ? payload.error
                    : missingUrl
                      ? "El comando dio el clip por terminado pero no devolvió vídeo"
                      : "La generación falló",
                at: Date.now(),
              }
            : undefined,
      };
    },
  };
}

export const cliPlugin: ProviderPlugin = {
  id: "cli",
  label: "Línea de comandos",
  description:
    "Cualquier binario que cumpla el contrato create/status. Sirve para envolver el CLI de un proveedor.",
  transport: "cli",
  fields: [
    {
      name: "command",
      label: "Comando",
      hint: commandsAllowed()
        ? "Se ejecuta sin shell: pon el binario aquí y los argumentos abajo."
        : "Desactivado. Pon ENGINE_ALLOW_COMMANDS=1 en el servidor para permitirlo.",
      kind: "command",
      required: true,
      placeholder: "/usr/local/bin/hf-bridge",
    },
    {
      name: "args",
      label: "Argumentos fijos",
      hint: "Se anteponen a create/status. Separados por espacios.",
      kind: "text",
      placeholder: "--profile agencia",
    },
  ],
  // See the note at the top of this file.
  needsPublicPhotos: true,
  create: createProvider,
  isConfigured: (config) => Boolean(config.command?.trim()),
};
