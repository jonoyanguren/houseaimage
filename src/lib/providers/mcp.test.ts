import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpClient } from "@/lib/mcp/client";
import {
  allowedDuration,
  higgsfieldMcpPlugin,
  resetMcpClients,
  resetModelCatalog,
} from "@/lib/providers/higgsfield-mcp";
import { ProviderError } from "@/lib/providers/errors";
import type { ResolvedPrompt } from "@/types/video";

/**
 * The MCP path, end to end, against a server we control.
 *
 * The transport is the risky part — a handshake, a session header, two body
 * formats — and none of it can be proved by reading the code. So this stands
 * up a real HTTP server that speaks JSON-RPC and drives the plugin through the
 * whole sequence a batch performs: import the photo, submit the job, poll it.
 *
 * No credentials and no network: it is the protocol under test, not Higgsfield.
 */

interface Call {
  tool: string;
  args: Record<string, unknown>;
}

const calls: Call[] = [];

/** What the fake server answers for `job_status`, so a test can steer it. */
let jobPayload: unknown = { status: "queued" };
/** When set, every tool call comes back as an MCP error. */
let failWith: { code: number; message: string } | null = null;
/** Answer as an SSE stream instead of JSON, which servers may do. */
let useEventStream = false;
/** Tools the server admits to having. */
let toolNames = [
  "media_upload",
  "media_confirm",
  "media_import_url",
  "generate_video",
  "job_status",
];
/** Overrides what job_status answers with. */
let statusPayload: Record<string, unknown> | null = null;
/** An extra catalogue entry a test can add. */
let catalogExtra: Record<string, unknown> | null = null;
/** Bytes the fake storage received on its presigned PUT. */
let uploaded: Buffer | null = null;
/** Content-Type the PUT arrived with, which has to match what was signed. */
let uploadedType: string | null = null;
/** When set, every tool answers with an error result carrying this text. */
let toolError: string | null = null;
/** When set, the server rejects anything without this exact bearer. */
let requiredBearer: string | null = null;
/** Bearers the server has been shown, in order. */
const seenBearers: (string | null)[] = [];

let server: Server | undefined;
let url = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    // A photograph to read. One pixel is enough: nothing inspects it.
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return;
    }

    // The presigned upload: raw bytes, not JSON-RPC.
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk as Buffer));
      req.on("end", () => {
        uploaded = Buffer.concat(chunks);
        uploadedType = req.headers["content-type"] ?? null;
        res.writeHead(200).end();
      });
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));

    req.on("end", () => {
      const message = JSON.parse(body || "{}");

      if (requiredBearer) {
        const auth = req.headers.authorization ?? null;
        seenBearers.push(auth);
        if (auth !== `Bearer ${requiredBearer}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
      }

      // A notification carries no id and expects no answer.
      if (message.id === undefined) {
        res.writeHead(202).end();
        return;
      }

      const reply = (result: unknown) => {
        const envelope = { jsonrpc: "2.0", id: message.id, result };

        if (useEventStream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Mcp-Session-Id": "sesion-1",
          });
          // A progress frame before the answer, as a real server would.
          res.end(
            `data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n` +
              `data: ${JSON.stringify(envelope)}\n\n`
          );
          return;
        }

        res.writeHead(200, {
          "Content-Type": "application/json",
          "Mcp-Session-Id": "sesion-1",
        });
        res.end(JSON.stringify(envelope));
      };

      if (message.method === "initialize") {
        reply({ protocolVersion: "2025-06-18", capabilities: {}, serverInfo: {} });
        return;
      }

      if (message.method === "tools/list") {
        reply({ tools: toolNames.map((name) => ({ name })) });
        return;
      }

      if (message.method === "tools/call") {
        const { name, arguments: args } = message.params;
        calls.push({ tool: name, args });

        if (failWith) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              error: failWith,
            })
          );
          return;
        }

        if (toolError) {
          reply({ content: [{ type: "text", text: toolError }], isError: true });
          return;
        }

        if (name === "media_upload") {
          reply({
            structuredContent: {
              uploads: [
                {
                  media_id: "media-42",
                  upload_url: `${url.replace("/mcp", "")}/subida`,
                  content_type: args?.content_type ?? "image/jpeg",
                },
              ],
            },
          });
          return;
        }

        if (name === "media_confirm") {
          reply({ structuredContent: { results: [{ status: "uploaded" }] } });
          return;
        }

        if (name === "models_explore") {
          reply({
            structuredContent: {
              items: [
                ...(catalogExtra ? [catalogExtra] : []),
                {
                  id: "cine",
                  name: "Cinema Studio",
                  provider_name: "Higgsfield",
                  description: "Cinemático",
                  durations: [5, 10],
                  aspect_ratios: ["16:9", "9:16"],
                  medias: [{ type: "image", roles: ["image", "start_image"] }],
                },
                {
                  id: "rango",
                  name: "Modelo con rango",
                  duration_range: { min: 3, max: 12 },
                  medias: [{ type: "image", roles: ["start_image"] }],
                },
                {
                  // No opening frame: cannot do the one thing this app does.
                  id: "clipify",
                  name: "Personal Clipper",
                  medias: [],
                },
              ],
            },
          });
          return;
        }

        if (name === "balance") {
          reply({ structuredContent: { credits: 839.5 } });
          return;
        }

        if (name === "generate_video" && args?.params?.get_cost) {
          reply({ structuredContent: { cost: { credits: 7, credits_exact: 7.5 } } });
          return;
        }

        if (name === "media_import_url") {
          // Nested on purpose: servers wrap their answers differently and the
          // plugin has to find the value wherever it is.
          reply({ structuredContent: { data: { media_id: "media-42" } } });
          return;
        }

        if (name === "generate_video") {
          // This one answers in a text block, the other common shape.
          reply({
            content: [{ type: "text", text: '{"job_id":"job-7","status":"queued"}' }],
          });
          return;
        }

        if (name === "job_status") {
          reply({ structuredContent: statusPayload ?? jobPayload });
          return;
        }

        reply({ content: [{ type: "text", text: "?" }], isError: true });
        return;
      }

      reply({});
    });
  });

  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/mcp`;
});

afterAll(() => {
  server?.close();
  resetMcpClients();
});

function reset() {
  calls.length = 0;
  statusPayload = null;
  catalogExtra = null;
  uploaded = null;
  uploadedType = null;
  resetModelCatalog();
  toolError = null;
  requiredBearer = null;
  seenBearers.length = 0;
  jobPayload = { status: "queued" };
  failWith = null;
  useEventStream = false;
  toolNames = [
    "media_upload",
    "media_confirm",
    "media_import_url",
    "generate_video",
    "job_status",
  ];
  resetMcpClients();
}

const resolved: ResolvedPrompt = {
  prompt: "slow dolly into the living space",
  negative: "no people",
  styleId: "cinematografico",
  sceneType: "salon",
  propertyType: "piso",
  aspectRatio: "16:9",
  durationSeconds: 7,
};

function provider() {
  return higgsfieldMcpPlugin.create({ url });
}

/** A photograph the provider can actually read, served by the fake server. */
function photoUrl(name = "salon.jpg"): string {
  return `${url.replace("/mcp", "")}/${name}`;
}

describe("McpClient", () => {
  it("handshakes once and reuses the connection", async () => {
    reset();
    const client = new McpClient({ kind: "http", url });

    expect(await client.listTools()).toContain("generate_video");
    expect(await client.listTools()).toContain("job_status");

    client.close();
  });

  it("reads a reply delivered as an event stream", async () => {
    reset();
    useEventStream = true;
    const client = new McpClient({ kind: "http", url });

    // The answer is the last data frame, after the progress notification.
    expect(await client.listTools()).toContain("job_status");

    client.close();
  });
});

describe("higgsfield-mcp plugin", () => {
  it("uploads the photo rather than asking the vendor to fetch it", async () => {
    // Uploading is what makes this work without a public address — and what
    // works at all, since their URL import signs one content type and sends
    // another.
    reset();
    const job = await provider().createClipJob({
      imageUrl: photoUrl("foto.jpg"),
      resolved,
    });

    expect(calls.map((c) => c.tool)).toEqual([
      "media_upload",
      "media_confirm",
      "models_explore",
      "generate_video",
    ]);
    expect(job).toMatchObject({ providerJobId: "job-7", status: "queued" });
  });

  it("sends the bytes with the content type it declared", async () => {
    // A mismatch between the two is precisely how a presigned signature fails.
    reset();
    await provider().createClipJob({
      imageUrl: photoUrl("foto.jpg"),
      resolved,
    });

    expect(uploaded).not.toBeNull();
    expect(uploadedType).toBe(calls[0].args.content_type);
  });

  it("falls back to a URL import when the server has no upload tools", async () => {
    reset();
    toolNames = ["media_import_url", "generate_video", "job_status"];

    await provider().createClipJob({
      imageUrl: photoUrl(),
      resolved,
    });

    expect(calls.map((c) => c.tool)).toContain("media_import_url");
    expect(uploaded).toBeNull();
  });

  it("sends the resolved prompt and the imported media as the start frame", async () => {
    reset();
    await provider().createClipJob({
      imageUrl: photoUrl(),
      resolved,
    });

    const submit = calls.find((c) => c.tool === "generate_video")!;
    const params = (submit.args as { params: Record<string, unknown> }).params;
    expect(params).toMatchObject({
      prompt: resolved.prompt,
      aspect_ratio: "16:9",
      duration: 7,
      medias: [{ role: "start_image", value: "media-42" }],
    });
  });

  it("finds the job id in a text answer as readily as a structured one", async () => {
    reset();
    const job = await provider().createClipJob({
      imageUrl: photoUrl("a.jpg"),
      resolved,
    });

    expect(job.providerJobId).toBe("job-7");
  });

  it("reports a finished job with its video", async () => {
    reset();
    jobPayload = { status: "completed", results: [{ url: "https://cdn.test/a.mp4" }] };

    const status = await provider().getClipJobStatus("job-7");

    expect(status).toMatchObject({
      status: "completed",
      videoUrl: "https://cdn.test/a.mp4",
    });
  });

  it("treats a finished job with no video as a failure, not a gap in the reel", async () => {
    reset();
    jobPayload = { status: "completed" };

    const status = await provider().getClipJobStatus("job-7");

    expect(status.status).toBe("failed");
    expect(status.failure?.kind).toBe("provider_error");
  });

  it("treats an unknown state as still running, never as failed", async () => {
    // A clip wrongly marked failed can never recover; one wrongly marked
    // processing corrects itself on the next poll.
    reset();
    jobPayload = { status: "materialising" };

    expect((await provider().getClipJobStatus("job-7")).status).toBe("processing");
  });

  it("classifies an auth error as permanent, so it is not retried", async () => {
    reset();
    failWith = { code: 401, message: "no autorizado" };

    await expect(
      provider().createClipJob({ imageUrl: photoUrl("a.jpg"), resolved })
    ).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("classifies a rate limit as transient, with its own backoff", async () => {
    reset();
    failWith = { code: 429, message: "demasiadas peticiones" };

    await expect(
      provider().createClipJob({ imageUrl: photoUrl("a.jpg"), resolved })
    ).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("tells the operator to authorise when the server rejects us", async () => {
    // A 401 from a remote server means the browser step has not happened, not
    // that the configuration is wrong.
    reset();
    requiredBearer = "algo-que-no-tenemos";

    const verification = await provider().verifyCredentials!();

    expect(verification).toMatchObject({ ok: true, verified: false });
    expect(verification.message).toContain("Autorizar");
  });

  it("refuses to connect to a server that cannot render", async () => {
    reset();
    toolNames = ["media_import_url"];

    const verification = await provider().verifyCredentials!();

    expect(verification.ok).toBe(false);
    expect(verification.message).toContain("generate_video");
  });

  it("confirms a server that offers the tools it needs", async () => {
    reset();
    const verification = await provider().verifyCredentials!();

    expect(verification).toMatchObject({ ok: true, verified: true });
  });

  it("says what is missing rather than failing obscurely", async () => {
    reset();
    // Neither a URL nor a command: there is nothing to talk to.
    const bare = higgsfieldMcpPlugin.create({});

    await expect(
      bare.createClipJob({ imageUrl: photoUrl("a.jpg"), resolved })
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("expiring credentials", () => {
  it("renews once on a 401 and finishes the call", async () => {
    // The whole point of the refresh path: a token that expires in the middle
    // of a batch must cost a round trip, not a failed clip.
    reset();
    requiredBearer = "nuevo";

    let handed = "viejo";
    const client = new McpClient({
      kind: "http",
      url,
      authorize: async () => handed,
      reauthorize: async () => {
        handed = "nuevo";
        return true;
      },
    });

    expect(await client.listTools()).toContain("generate_video");
    expect(seenBearers[0]).toBe("Bearer viejo");
    expect(seenBearers.some((b) => b === "Bearer nuevo")).toBe(true);

    client.close();
  });

  it("gives up after one renewal rather than looping", async () => {
    reset();
    requiredBearer = "inalcanzable";

    const client = new McpClient({
      kind: "http",
      url,
      authorize: async () => "viejo",
      // Claims to have renewed, but hands back the same rejected token.
      reauthorize: async () => true,
    });

    await expect(client.listTools()).rejects.toMatchObject({ code: 401 });

    client.close();
  });
});

describe("what a tool refuses", () => {
  it("calls an HTTPS refusal permanent, and says what to do about it", async () => {
    // The one everybody hits: photos served from localhost, which the provider
    // downloads itself and cannot reach. Retrying it can never work, so the
    // engine must not spend attempts — or the customer's money — on it.
    reset();
    toolError = "Error: media_import_url only accepts https:// URLs";

    await expect(
      provider().createClipJob({ imageUrl: photoUrl("a.jpg"), resolved })
    ).rejects.toMatchObject({ kind: "invalid_input" });

    const failure = await provider()
      .createClipJob({ imageUrl: photoUrl("a.jpg"), resolved })
      .catch((err: Error) => err.message);

    expect(failure).toContain("APP_URL");
  });

  it("keeps a rate limit transient, with its own backoff", async () => {
    reset();
    toolError = "Rate limit exceeded, try again later";

    await expect(
      provider().createClipJob({ imageUrl: photoUrl("a.jpg"), resolved })
    ).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("treats an unrecognised refusal as transient, because giving up costs more", async () => {
    reset();
    toolError = "Something went sideways on our end";

    await expect(
      provider().createClipJob({ imageUrl: photoUrl("a.jpg"), resolved })
    ).rejects.toMatchObject({ kind: "provider_error" });
  });
});

describe("finding the finished video", () => {
  it("takes the result, not the photograph echoed back in params", async () => {
    // The status response repeats the request, start image included. A blind
    // search for `url` found that JPEG first, so every clip came back
    // "completed" pointing at its own source photo: the reel played a
    // slideshow and the downloadable file would have failed on a still.
    reset();
    statusPayload = {
      generation: {
        status: "completed",
        params: {
          medias: [{ role: "start_image", data: { url: "https://cdn.test/foto.jpg" } }],
        },
        results: {
          rawUrl: "https://cdn.test/clip.mp4",
          thumbnailUrl: "https://cdn.test/miniatura.jpg",
        },
      },
    };

    const status = await provider().getClipJobStatus("job-7");
    expect(status.videoUrl).toBe("https://cdn.test/clip.mp4");
  });

  it("refuses an image even when nothing else is offered", async () => {
    // A clip with no URL is visibly incomplete. One with the wrong URL is not.
    reset();
    statusPayload = {
      generation: {
        status: "completed",
        results: { thumbnailUrl: "https://cdn.test/miniatura.jpg" },
      },
    };

    expect((await provider().getClipJobStatus("job-7")).videoUrl).toBeUndefined();
  });
});

describe("the catalogue", () => {
  it("offers only models that accept an opening frame", async () => {
    // The same catalogue carries a model that turns a YouTube URL into clips.
    // It is a video model, and it cannot do the one thing this app does.
    reset();
    const models = await provider().listModels!();

    expect(models.map((m) => m.id)).toEqual(["cine", "rango"]);
  });

  it("keeps what a chooser needs to show", async () => {
    reset();
    const [cine] = await provider().listModels!();

    expect(cine).toMatchObject({
      label: "Cinema Studio",
      vendor: "Higgsfield",
      durations: [5, 10],
      aspectRatios: ["16:9", "9:16"],
    });
  });

  it("reads the balance", async () => {
    reset();
    expect(await provider().getBalance!()).toBe(839.5);
  });

  it("treats an unreadable balance as a missing number, not a failure", async () => {
    reset();
    failWith = { code: 500, message: "no" };

    await expect(provider().getBalance!()).resolves.toBeUndefined();
  });
});

describe("choosing the model's constraints", () => {
  it("matches by id instead of trusting the first entry", async () => {
    // A server that answers `get` with an unfiltered list would otherwise hand
    // us another model's durations and we would round every clip wrongly.
    reset();
    await higgsfieldMcpPlugin
      .create({ url, model: "rango" })
      .createClipJob({ imageUrl: photoUrl("a.jpg"), resolved });

    const submit = calls.find((c) => c.tool === "generate_video")!;
    const params = (submit.args as { params: { duration: number } }).params;

    // "rango" allows 3-12, so the style's seven seconds survive intact. Had we
    // taken the first entry ("cine", 5 or 10) it would have become five.
    expect(params.duration).toBe(7);
  });
});

describe("where a model hides its durations", () => {
  it("reads them from a duration parameter's options", async () => {
    // Seedance keeps its 4/8/12 there rather than in a top-level list, and we
    // were only looking at the top level — so every clip asked for a length
    // the model does not accept.
    reset();
    catalogExtra = {
      id: "seedance",
      name: "Seedance",
      medias: [{ type: "image", roles: ["start_image"] }],
      parameters: [{ name: "duration", options: [4, 8, 12], default: 4 }],
    };

    const models = await provider().listModels!();
    expect(models.find((m) => m.id === "seedance")?.durations).toEqual([4, 8, 12]);
  });
});

describe("allowedDuration", () => {
  it("snaps to the nearest length a model lists", () => {
    // A drone reel wants eight seconds and this model only does five or ten.
    const model = { id: "cine", label: "Cinema", durations: [5, 10] };

    expect(allowedDuration(model, 8)).toBe(10);
    expect(allowedDuration(model, 6)).toBe(5);
    expect(allowedDuration(model, 5)).toBe(5);
  });

  it("clamps into a continuous range", () => {
    const model = { id: "r", label: "R", minSeconds: 3, maxSeconds: 12 };

    expect(allowedDuration(model, 20)).toBe(12);
    expect(allowedDuration(model, 1)).toBe(3);
    expect(allowedDuration(model, 7)).toBe(7);
  });

  it("leaves the request alone when nothing is known", () => {
    expect(allowedDuration(undefined, 8)).toBe(8);
  });
});

describe("what it will cost", () => {
  it("asks the backend rather than working it out here", async () => {
    reset();
    const estimate = await higgsfieldMcpPlugin
      .create({ url, model: "cine" })
      .estimateCost!({ aspectRatio: "16:9", durationSeconds: 5, clips: 10 });

    expect(estimate).toMatchObject({ perClip: 7.5, total: 75 });
  });

  it("quotes without submitting anything", async () => {
    reset();
    await higgsfieldMcpPlugin
      .create({ url, model: "cine" })
      .estimateCost!({ aspectRatio: "16:9", durationSeconds: 5, clips: 1 });

    const quote = calls.find((c) => c.tool === "generate_video")!;
    expect((quote.args as { params: { get_cost: boolean } }).params.get_cost).toBe(true);
  });

  it("says so when the model will not honour the style's length", async () => {
    // Silently rounding is how someone ends up with ten-second clips they did
    // not ask for and did not price.
    reset();
    const estimate = await higgsfieldMcpPlugin
      .create({ url, model: "cine" })
      .estimateCost!({ aspectRatio: "16:9", durationSeconds: 8, clips: 3 });

    expect(estimate.note).toContain("10s");
  });
});
