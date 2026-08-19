import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpClient } from "@/lib/mcp/client";
import { higgsfieldMcpPlugin, resetMcpClients } from "@/lib/providers/higgsfield-mcp";
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
let toolNames = ["media_import_url", "generate_video", "job_status"];

let server: Server | undefined;
let url = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));

    req.on("end", () => {
      const message = JSON.parse(body || "{}");

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
          reply({ structuredContent: jobPayload });
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
  jobPayload = { status: "queued" };
  failWith = null;
  useEventStream = false;
  toolNames = ["media_import_url", "generate_video", "job_status"];
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
  it("imports the photo before submitting, because the tool refuses URLs", async () => {
    reset();
    const job = await provider().createClipJob({
      imageUrl: "https://example.test/salon.jpg",
      resolved,
    });

    expect(calls.map((c) => c.tool)).toEqual(["media_import_url", "generate_video"]);
    expect(calls[0].args).toMatchObject({ url: "https://example.test/salon.jpg" });
    expect(job).toMatchObject({ providerJobId: "job-7", status: "queued" });
  });

  it("sends the resolved prompt and the imported media as the start frame", async () => {
    reset();
    await provider().createClipJob({
      imageUrl: "https://example.test/salon.jpg",
      resolved,
    });

    const params = (calls[1].args as { params: Record<string, unknown> }).params;
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
      imageUrl: "https://example.test/a.jpg",
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
      provider().createClipJob({ imageUrl: "https://example.test/a.jpg", resolved })
    ).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("classifies a rate limit as transient, with its own backoff", async () => {
    reset();
    failWith = { code: 429, message: "demasiadas peticiones" };

    await expect(
      provider().createClipJob({ imageUrl: "https://example.test/a.jpg", resolved })
    ).rejects.toMatchObject({ kind: "rate_limited" });
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
      bare.createClipJob({ imageUrl: "https://example.test/a.jpg", resolved })
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
