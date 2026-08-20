import type {
  CostEstimate,
  CostQuery,
  CreateClipInput,
  ProviderClipJob,
  ProviderClipStatus,
  VideoModelInfo,
  VideoProvider,
} from "@/types/video";
import type { PluginConfig, ProviderPlugin } from "@/types/plugin";
import type { ProviderVerification } from "@/types/settings";
import { McpClient, McpError, commandsAllowed, type McpConfig } from "@/lib/mcp/client";
import { getAccessToken, isConnected, renew } from "@/lib/mcp/connection";
import { ProviderError } from "@/lib/providers/errors";
import { splitArgs } from "@/lib/providers/args";
import { normalizeStatus } from "@/lib/providers/status";
import { DEFAULT_CLIP_SECONDS } from "@/lib/config";

/**
 * Higgsfield over MCP.
 *
 * Same vendor and the same clip-per-photo contract as the REST provider; only
 * the wire changes. It exists because an operator who already has Higgsfield
 * connected as an MCP server has credentials and a session there, and asking
 * them to go and mint a second API key for this app is asking them to do the
 * integration twice.
 *
 * The call sequence is fixed by the server's own tool contract:
 *
 *   media_import_url(url)  →  media_id
 *   generate_video({ model, prompt, medias: [{ role: "start_image", … }] })  →  job id
 *   job_status(jobId)  →  status + video url
 *
 * The photo is **uploaded**, not handed over as a URL. That is the difference
 * between this working and not:
 *
 * - `media_import_url` asks the vendor to fetch a URL, which means the photos
 *   have to be publicly reachable over TLS — a tunnel or a deployment, just to
 *   try the product. And at the time of writing their import is broken: it
 *   signs the upload to its own S3 for one content type and sends another, so
 *   every call comes back `SignatureDoesNotMatch`.
 * - `media_upload` hands us a presigned URL, we PUT the bytes ourselves and
 *   confirm. It works, and it needs no public address at all: the server reads
 *   the file from wherever it already lives.
 *
 * So upload is the path, and the URL import is only a fallback for a server
 * that does not offer the upload tools.
 */

/** Higgsfield's tool names. Constants so a rename is one edit, not a hunt. */
const TOOL_IMPORT = "media_import_url";
const TOOL_UPLOAD = "media_upload";
const TOOL_CONFIRM = "media_confirm";
const TOOL_GENERATE = "generate_video";
const TOOL_STATUS = "job_status";
const TOOL_MODELS = "models_explore";
const TOOL_BALANCE = "balance";

/**
 * The role that means "this photograph is the opening frame".
 *
 * The catalogue is filtered by it, and that filter is the difference between a
 * useful list and a trap: the same catalogue carries a model that turns a
 * YouTube URL into clips and one that builds product ads from a folder. Both
 * are video models. Neither can do the one thing this app does.
 */
const START_FRAME_ROLE = "start_image";

/**
 * Default generation model.
 *
 * The catalogue moves, so it is a configurable field with this as the
 * fallback; the server's own guidance points here for image-driven work.
 */
/**
 * The model used when nobody has chosen one.
 *
 * It has to be one that animates a **starting photograph**, and that is a
 * narrower set than "video models": the previous default here defaulted to
 * text-to-video and rejected the photo outright —
 * `mode 't2v' does not accept reference media` — so every single clip failed
 * with a validation error. This one is verified end to end, from uploaded
 * photograph to finished MP4.
 */
const DEFAULT_MODEL = "seedance1_5";

/**
 * Model descriptions, cached per server and model.
 *
 * Every clip needs the same answer — what durations does this model accept —
 * and a batch is twenty clips. Asking the catalogue twenty times would add a
 * round trip to each photograph for information that does not change.
 */
const globalForCatalog = globalThis as unknown as {
  __houseaimageModelInfo?: Map<string, VideoModelInfo | null>;
  __houseaimageMcpTools?: Map<string, string[]>;
};

/** Which tools a server offers, asked once per server. */
const toolNames: Map<string, string[]> = (globalForCatalog.__houseaimageMcpTools ??=
  new Map<string, string[]>());

const modelInfo: Map<string, VideoModelInfo | null> = (globalForCatalog.__houseaimageModelInfo ??=
  new Map<string, VideoModelInfo | null>());

/** Test seam, and the escape hatch when a catalogue changes under us. */
export function resetModelCatalog(): void {
  modelInfo.clear();
  toolNames.clear();
}

/** One client per configuration, kept alive across polls. */
const globalForMcp = globalThis as unknown as {
  __houseaimageMcpClients?: Map<string, McpClient>;
};

const clients: Map<string, McpClient> = (globalForMcp.__houseaimageMcpClients ??=
  new Map<string, McpClient>());

function transportFor(config: PluginConfig): McpConfig {
  const command = config.command?.trim();

  // A local server wins when configured: an operator who typed a command meant
  // it. Otherwise the hosted server, which is what works on serverless.
  if (command) {
    return { kind: "stdio", command, args: splitArgs(config.args) };
  }

  const url = config.url?.trim();
  if (!url) {
    throw new ProviderError(
      "unauthorized",
      "El plugin MCP necesita la URL del servidor o un comando local. Conéctalo en Ajustes."
    );
  }

  return {
    kind: "http",
    url,
    // Fetched per request rather than captured: an OAuth access token expires
    // mid-batch, and a value read when the client was built would be stale by
    // the tenth clip.
    authorize: () => getAccessToken(url),
    // One silent renewal before a rejection becomes the operator's problem.
    reauthorize: async () => Boolean(await renew(url)),
  };
}

function clientFor(config: PluginConfig): McpClient {
  const transport = transportFor(config);
  // Keyed by the values rather than the transport object, which now carries
  // functions and cannot be serialised. Changing the URL or the command still
  // opens a new connection instead of reusing the old session.
  const key = `${config.url ?? ""}|${config.command ?? ""}|${config.args ?? ""}`;

  let client = clients.get(key);
  if (!client) {
    client = new McpClient(transport);
    clients.set(key, client);
  }

  return client;
}

/** Forget every cached connection. Used when the configuration changes. */
export function resetMcpClients(): void {
  for (const client of clients.values()) client.close();
  clients.clear();
}

/**
 * Read a tool result into something we can inspect.
 *
 * MCP servers may answer with `structuredContent`, with JSON inside a text
 * block, or with prose. The tool *inputs* are pinned by the server's schema;
 * the outputs are not, so this stays deliberately forgiving.
 */
function payloadOf(result: { structured?: unknown; text: string }): unknown {
  if (result.structured !== undefined) return result.structured;

  const trimmed = result.text.trim();
  if (!trimmed) return undefined;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Some servers wrap the JSON in explanation. Take the first object in it.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* Fall through to the raw text. */
      }
    }
    return trimmed;
  }
}

/**
 * Depth-first search for the first of `keys` that carries a usable value.
 *
 * Servers nest their answers differently — `{ job_id }`, `{ data: { id } }`,
 * `{ generations: [{ id }] }` — and this app only needs three values out of
 * any of those shapes.
 */
function pick(payload: unknown, keys: readonly string[], depth = 0): unknown {
  if (payload === null || payload === undefined || depth > 6) return undefined;

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = pick(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  if (typeof payload !== "object") return undefined;

  const record = payload as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return value;
  }

  for (const value of Object.values(record)) {
    const found = pick(value, keys, depth + 1);
    if (found !== undefined) return found;
  }

  return undefined;
}

const JOB_ID_KEYS = ["jobId", "job_id", "id", "generation_id"] as const;
const MEDIA_ID_KEYS = ["media_id", "mediaId", "id"] as const;
const STATUS_KEYS = ["status", "state", "job_status"] as const;
const VIDEO_KEYS = [
  "rawUrl",
  "raw_url",
  "video_url",
  "videoUrl",
  "output_url",
  "result_url",
  "url",
] as const;

/** Where a finished result hides, depending on the server. */
const RESULT_CONTAINERS = ["results", "result", "output", "outputs"] as const;

/** A still image is never the answer to "where is the video". */
const IMAGE_URL = /\.(jpe?g|png|webp|gif|avif|heic)(\?|$)/i;

/**
 * The finished video's URL.
 *
 * Searched inside the result container, and **never** in `params` — which is
 * the bug this replaces. The status response echoes the request back, start
 * image included, so a blind deep search for `url` found the source photograph
 * before it ever reached the video. Every clip came back `completed` pointing
 * at its own JPEG: the reel played a slideshow and the downloadable file would
 * have failed on a still.
 *
 * Anything that still looks like an image is refused for the same reason. A
 * clip with no URL is visibly incomplete; a clip with the wrong one is not.
 */
function findVideoUrl(payload: unknown): string | undefined {
  const wrapper = payload as { generation?: unknown } | undefined;
  const record = (wrapper?.generation ?? payload) as Record<string, unknown> | undefined;

  if (!record || typeof record !== "object") return undefined;

  const usable = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0 && !IMAGE_URL.test(value);

  for (const container of RESULT_CONTAINERS) {
    const found = pick(record[container], VIDEO_KEYS);
    if (usable(found)) return found;
  }

  // Some servers put it at the top level. `params` stays excluded: that is
  // where the request — and the start image — is echoed back.
  const { params, ...rest } = record;
  void params;

  const found = pick(rest, VIDEO_KEYS);
  return usable(found) ? found : undefined;
}
const PROGRESS_KEYS = ["progress", "percent", "percentage"] as const;

/**
 * Classify what a tool complained about.
 *
 * A tool error is not a transport error: the call arrived, the server
 * understood it and refused. Some of those refusals are permanent, and
 * treating them as transient burns the retry budget — and the customer's
 * money — on work that cannot succeed.
 *
 * The HTTPS case earns its own message because it is the one everybody hits:
 * the photos are served from `localhost` in development, and the provider
 * downloads them itself. The raw wording tells you what is wrong; this tells
 * you what to do.
 */
function classifyToolError(tool: string, detail: string): ProviderError {
  const text = detail.toLowerCase();

  if (text.includes("https")) {
    return new ProviderError(
      "invalid_input",
      "Higgsfield descarga las fotos él mismo y solo acepta HTTPS público. " +
        "Ahora se sirven desde una dirección local, que él no puede alcanzar: " +
        "publica la aplicación o levanta un túnel y pon APP_URL con esa URL."
    );
  }

  if (text.includes("rate limit") || text.includes("too many")) {
    return new ProviderError("rate_limited", `${tool}: ${detail}`);
  }

  // A model that refuses these parameters will refuse them again. The wording
  // that matters here is a validation failure — `params failed validation`,
  // `422`, `value error` — which is how a model says the request was never
  // going to work, most often because it does not animate a starting image.
  if (
    text.includes("failed validation") ||
    text.includes("value error") ||
    text.includes("422") ||
    text.includes("invalid") ||
    text.includes("unsupported") ||
    text.includes("not allowed") ||
    text.includes("does not accept") ||
    text.includes("must be")
  ) {
    return new ProviderError("invalid_input", `${tool}: ${detail}`);
  }

  return new ProviderError("provider_error", `${tool}: ${detail}`);
}

/** Extensions the vendor's storage keys on, derived from the MIME type. */
function extensionFor(contentType: string): string {
  const subtype = contentType.split("/")[1]?.split(";")[0]?.toLowerCase() ?? "";
  if (subtype === "png") return "png";
  if (subtype === "webp") return "webp";
  return "jpg";
}

interface UploadTicket {
  mediaId: string;
  uploadUrl: string;
  contentType: string;
}

function readTicket(payload: unknown): UploadTicket | undefined {
  const uploads = (payload as { uploads?: unknown[] })?.uploads;
  const first = Array.isArray(uploads) ? uploads[0] : payload;
  if (!first || typeof first !== "object") return undefined;

  const record = first as Record<string, unknown>;
  const mediaId = record.media_id ?? record.mediaId;
  const uploadUrl = record.upload_url ?? record.uploadUrl;

  if (typeof mediaId !== "string" || typeof uploadUrl !== "string") return undefined;

  return {
    mediaId,
    uploadUrl,
    contentType:
      typeof record.content_type === "string" ? record.content_type : "image/jpeg",
  };
}

/** Turn anything the client throws into a classified provider failure. */
function asProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;

  const message = err instanceof Error ? err.message : "Error del servidor MCP";

  // An auth failure is permanent: retrying spends attempts on a wall.
  if (err instanceof McpError && (err.code === 401 || err.code === 403)) {
    return new ProviderError("unauthorized", message, err.code);
  }
  if (err instanceof McpError && err.code === 429) {
    return new ProviderError("rate_limited", message, err.code);
  }

  return new ProviderError("provider_error", message);
}

/** Read one model entry into the shape a chooser needs. */
function toModelInfo(raw: Record<string, unknown>): VideoModelInfo | undefined {
  const id = typeof raw.id === "string" ? raw.id : undefined;
  if (!id) return undefined;

  // Only image-to-video: everything else in the catalogue would fail on the
  // first photo, and offering it is worse than hiding it.
  const medias = Array.isArray(raw.medias) ? raw.medias : [];
  const acceptsStartFrame = medias.some((media) => {
    const roles = (media as { roles?: unknown }).roles;
    return Array.isArray(roles) && roles.includes(START_FRAME_ROLE);
  });
  if (!acceptsStartFrame) return undefined;

  const range = raw.duration_range as { min?: number; max?: number } | undefined;

  // Three places, because the catalogue uses all three: a top-level list, a
  // top-level range, or the options of a `duration` parameter — which is where
  // Seedance keeps its 4/8/12 and where we were not looking, so every clip was
  // sent a length the model does not accept.
  const parameters = Array.isArray(raw.parameters) ? raw.parameters : [];
  const durationParam = parameters.find(
    (param) => (param as { name?: unknown }).name === "duration"
  ) as { options?: unknown; min?: unknown; max?: unknown } | undefined;

  const listed = Array.isArray(raw.durations) ? raw.durations : durationParam?.options;
  const durations = Array.isArray(listed)
    ? listed.filter((d): d is number => typeof d === "number")
    : undefined;

  return {
    id,
    label: typeof raw.name === "string" ? raw.name : id,
    description: typeof raw.description === "string" ? raw.description : undefined,
    vendor: typeof raw.provider_name === "string" ? raw.provider_name : undefined,
    durations: durations?.length ? durations : undefined,
    minSeconds:
      typeof range?.min === "number"
        ? range.min
        : typeof durationParam?.min === "number"
          ? durationParam.min
          : undefined,
    maxSeconds:
      typeof range?.max === "number"
        ? range.max
        : typeof durationParam?.max === "number"
          ? durationParam.max
          : undefined,
    aspectRatios: Array.isArray(raw.aspect_ratios)
      ? raw.aspect_ratios.filter((a): a is string => typeof a === "string")
      : undefined,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string")
      : undefined,
  };
}

/**
 * The length this model will actually render.
 *
 * A style fixes its own clip length — a drone reel runs on eight seconds — and
 * a model may only accept five or ten. Sending eight anyway gets it silently
 * rounded somewhere we cannot see, so it is rounded here, where the estimate
 * and the submission can agree on the same number.
 */
export function allowedDuration(model: VideoModelInfo | undefined, wanted: number): number {
  if (!model) return wanted;

  if (model.durations?.length) {
    return model.durations.reduce((best, option) =>
      Math.abs(option - wanted) < Math.abs(best - wanted) ? option : best
    );
  }

  const low = model.minSeconds ?? wanted;
  const high = model.maxSeconds ?? wanted;
  return Math.min(Math.max(wanted, low), high);
}

function createProvider(config: PluginConfig): VideoProvider {
  const model = config.model?.trim() || DEFAULT_MODEL;

  async function call(tool: string, args: Record<string, unknown>) {
    const result = await clientFor(config).callTool(tool, args);

    if (result.isError) {
      throw classifyToolError(
        tool,
        result.text.slice(0, 300) || "el servidor MCP devolvió un error"
      );
    }

    return payloadOf(result);
  }

  /**
   * This model's constraints, fetched once and remembered.
   *
   * Every clip in a batch needs the same answer, and a batch is twenty clips:
   * asking the catalogue each time would add a round trip per photograph for
   * information that does not change.
   */
  async function describeChosenModel(): Promise<VideoModelInfo | undefined> {
    const key = `${config.url ?? config.command ?? ""}|${model}`;
    if (modelInfo.has(key)) return modelInfo.get(key) ?? undefined;

    try {
      const payload = await call(TOOL_MODELS, { action: "get", model_id: model });
      const items = (payload as { items?: unknown[] })?.items;

      // Matched by id rather than taking the first entry: a server that
      // answers `get` with an unfiltered list would otherwise hand us another
      // model's durations, and we would round every clip to the wrong length.
      const candidates = Array.isArray(items) ? items : [payload];
      const info = candidates
        .map((item) => toModelInfo(item as Record<string, unknown>))
        .find((candidate) => candidate?.id === model);

      modelInfo.set(key, info ?? null);
      return info;
    } catch {
      // Not knowing the constraints is no reason to refuse the clip: the
      // backend applies its own rounding, as it did before we asked.
      modelInfo.set(key, null);
      return undefined;
    }
  }

  /** The server's tool list, asked once. */
  async function listAvailableTools(): Promise<string[]> {
    const key = `tools|${config.url ?? config.command ?? ""}`;
    const cached = toolNames.get(key);
    if (cached) return cached;

    const tools = await clientFor(config).listTools();
    toolNames.set(key, tools);
    return tools;
  }

  /**
   * Put the photograph in the vendor's storage and return its id.
   *
   * Upload first, URL import only as a fallback: uploading works where the
   * import currently does not, and — the part that matters most for anyone
   * trying this out — it needs no public address at all. The bytes are read
   * from wherever the file already lives, including the server's own disk.
   */
  async function putPhoto(imageUrl: string): Promise<string> {
    const tools = await listAvailableTools();

    if (tools.includes(TOOL_UPLOAD)) {
      const source = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
      if (!source.ok) {
        throw new ProviderError(
          "invalid_input",
          `No se pudo leer la fotografía (${source.status}): ${imageUrl}`
        );
      }

      const contentType = source.headers.get("content-type") ?? "image/jpeg";
      const bytes = new Uint8Array(await source.arrayBuffer());

      const ticket = readTicket(
        await call(TOOL_UPLOAD, {
          filename: `foto.${extensionFor(contentType)}`,
          content_type: contentType,
        })
      );

      if (!ticket) {
        throw new ProviderError("provider_error", `${TOOL_UPLOAD} no devolvió una URL`);
      }

      // The declared type and the sent header have to agree or the presigned
      // signature does not validate — which is exactly how their own URL
      // import is broken today.
      const put = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": ticket.contentType },
        body: bytes,
        signal: AbortSignal.timeout(120_000),
      });

      if (!put.ok) {
        throw new ProviderError(
          "provider_error",
          `La subida de la fotografía falló (${put.status})`
        );
      }

      await call(TOOL_CONFIRM, { media_id: ticket.mediaId, type: "image" });
      return ticket.mediaId;
    }

    // A server without the upload tools: hand over a URL and hope their side
    // can reach it.
    const imported = await call(TOOL_IMPORT, { url: imageUrl, type: "image" });
    const mediaId = pick(imported, MEDIA_ID_KEYS);

    if (typeof mediaId !== "string") {
      throw new ProviderError(
        "provider_error",
        `${TOOL_IMPORT} no devolvió un media_id utilizable`
      );
    }

    return mediaId;
  }

  return {
    name: "higgsfield-mcp",

    async verifyCredentials(): Promise<ProviderVerification> {
      const url = config.url?.trim();
      const remote = Boolean(url) && !config.command?.trim();

      try {
        const tools = await clientFor(config).listTools();

        const missing = [TOOL_GENERATE, TOOL_STATUS].filter(
          (tool) => !tools.includes(tool)
        );

        if (missing.length > 0) {
          // Connected, but not to something that can render: worth refusing
          // now rather than at the first batch.
          return {
            ok: false,
            verified: true,
            message: `El servidor MCP responde pero no ofrece ${missing.join(" ni ")}.`,
          };
        }

        /*
         * The model is checked, not assumed. A configured id that does not
         * animate a starting photograph is accepted by the server and then
         * fails every single clip with a validation error — which is exactly
         * what happened with a stale `seedance_2_5` left behind in the
         * settings: authorised, connected, verified, and unable to render
         * anything at all.
         *
         * A warning rather than a refusal: the catalogue may be unreachable,
         * or may simply not describe a model that works fine.
         */
        const catalogue = await this.listModels!().catch(() => []);

        if (catalogue.length > 0) {
          const chosen = catalogue.find((entry) => entry.id === model);

          if (!chosen) {
            return {
              ok: true,
              verified: false,
              message:
                `Conectado, pero «${model}» no está entre los modelos que animan ` +
                "una fotografía. Elige uno de la lista o los clips fallarán.",
            };
          }
        }

        return {
          ok: true,
          verified: true,
          message: `Conectado por MCP · ${tools.length} herramientas disponibles.`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";

        // A rejection from a remote server is not a bad configuration: it is
        // an authorisation that has not happened yet. Telling the operator to
        // press the button beats handing them a 401.
        if (remote && (err instanceof McpError ? err.code === 401 : false)) {
          return {
            ok: true,
            verified: false,
            message:
              "El servidor responde y pide autorización. Pulsa «Autorizar en " +
              "Higgsfield»: usa OAuth, no una clave.",
          };
        }

        if (remote && !isConnected(url!)) {
          return {
            ok: true,
            verified: false,
            message: `Guardado, pero aún sin autorizar (${message}).`,
          };
        }

        return { ok: false, verified: true, message: `No se pudo conectar: ${message}` };
      }
    },

    async listModels(): Promise<VideoModelInfo[]> {
      const payload = await call(TOOL_MODELS, {
        action: "list",
        type: "video",
        limit: 60,
      });

      const items = (payload as { items?: unknown })?.items;
      if (!Array.isArray(items)) return [];

      return items
        .map((item) => toModelInfo(item as Record<string, unknown>))
        .filter((model): model is VideoModelInfo => Boolean(model));
    },

    async getBalance(): Promise<number | undefined> {
      try {
        const payload = await call(TOOL_BALANCE, {});
        const credits = pick(payload, ["credits", "balance"]);
        return typeof credits === "number" ? credits : undefined;
      } catch {
        // A balance we cannot read is a number missing from a panel, not a
        // reason to fail anything.
        return undefined;
      }
    },

    async estimateCost(query: CostQuery): Promise<CostEstimate> {
      const catalogue = await this.listModels!();
      const chosen = catalogue.find((m) => m.id === model);
      const duration = allowedDuration(chosen, query.durationSeconds);

      // Asked of the backend rather than computed here: only it knows what a
      // resolution, a second more or an audio track does to the price.
      const payload = await call(TOOL_GENERATE, {
        params: {
          model,
          prompt: "cost estimate",
          aspect_ratio: query.aspectRatio,
          duration,
          get_cost: true,
        },
      });

      const credits = pick(payload, ["credits_exact", "credits"]);
      if (typeof credits !== "number") {
        throw new ProviderError("provider_error", "El proveedor no devolvió un coste");
      }

      return {
        perClip: credits,
        total: credits * query.clips,
        note:
          duration !== query.durationSeconds
            ? `Este modelo no admite ${query.durationSeconds}s: los planos durarán ${duration}s.`
            : undefined,
      };
    },

    async createClipJob(input: CreateClipInput): Promise<ProviderClipJob> {
      const { resolved, options } = input;

      try {
        // The generation tool refuses raw URLs, so the photograph goes into
        // the vendor's storage first and is referenced by id.
        const mediaId = await putPhoto(input.imageUrl);

        const wanted =
          options?.durationSeconds ?? resolved.durationSeconds ?? DEFAULT_CLIP_SECONDS;

        const created = await call(TOOL_GENERATE, {
          params: {
            model,
            prompt: resolved.prompt,
            aspect_ratio: options?.aspectRatio ?? resolved.aspectRatio,
            // Rounded to what this model accepts, so the clip that comes back
            // is the length the estimate quoted rather than whatever the
            // backend silently substituted.
            duration: allowedDuration(await describeChosenModel(), wanted),
            // `start_image` is the declared role for the opening frame, which
            // is exactly what one photo means here.
            medias: [{ role: "start_image", value: mediaId }],
          },
        });

        const jobId = pick(created, JOB_ID_KEYS);
        if (typeof jobId !== "string") {
          throw new ProviderError(
            "provider_error",
            `${TOOL_GENERATE} no devolvió un identificador de trabajo`
          );
        }

        return {
          providerJobId: jobId,
          status: normalizeStatus(pick(created, STATUS_KEYS) ?? "queued"),
        };
      } catch (err) {
        throw asProviderError(err);
      }
    },

    async getClipJobStatus(providerJobId: string): Promise<ProviderClipStatus> {
      let payload: unknown;

      try {
        payload = await call(TOOL_STATUS, { jobId: providerJobId });
      } catch (err) {
        throw asProviderError(err);
      }

      const reported = normalizeStatus(pick(payload, STATUS_KEYS));
      const url = findVideoUrl(payload);

      // A finished job with no file is a broken contract, not a success — as
      // with the REST provider, treat it as retryable rather than letting a
      // silent gap into the reel.
      const missingUrl = reported === "completed" && !url;
      const status = missingUrl ? "failed" : reported;

      const progress = pick(payload, PROGRESS_KEYS);

      return {
        providerJobId,
        status,
        progress: typeof progress === "number" ? Math.round(progress) : undefined,
        videoUrl: url,
        failure:
          status === "failed"
            ? {
                kind: "provider_error",
                message: missingUrl
                  ? "El trabajo terminó pero no devolvió vídeo"
                  : "La generación falló en el proveedor",
                at: Date.now(),
              }
            : undefined,
      };
    },
  };
}

export const higgsfieldMcpPlugin: ProviderPlugin = {
  id: "higgsfield-mcp",
  label: "Higgsfield · MCP",
  description:
    "Habla con el servidor MCP de Higgsfield en vez de con su API REST. Útil si ya lo tienes conectado.",
  transport: "mcp",
  fields: [
    {
      name: "url",
      label: "URL del servidor MCP",
      hint: "Se autoriza con OAuth desde el botón, no con una clave pegada aquí.",
      kind: "url",
      placeholder: "https://mcp.higgsfield.ai/mcp",
    },
    {
      name: "command",
      label: "Comando local",
      hint: commandsAllowed()
        ? "Alternativa a la URL: lanza el servidor como proceso en este host."
        : "Desactivado. Pon ENGINE_ALLOW_COMMANDS=1 en el servidor para permitirlo.",
      kind: "command",
      placeholder: "npx -y @higgsfield/mcp",
    },
    {
      name: "model",
      label: "Modelo",
      hint: "Solo se ofrecen los que aceptan una foto como primer fotograma.",
      kind: "model",
      fallback: DEFAULT_MODEL,
      placeholder: DEFAULT_MODEL,
    },
  ],
  // See the note at the top of this file.
  needsPublicPhotos: false,
  create: createProvider,
  isConfigured: (config) =>
    Boolean(config.url?.trim()) || Boolean(config.command?.trim()),
};
