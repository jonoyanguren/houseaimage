import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/**
 * A very small MCP client.
 *
 * MCP is JSON-RPC 2.0 with a handshake, and we need exactly three verbs from
 * it — `initialize`, `tools/list`, `tools/call`. That is a few hundred lines,
 * which is cheaper than the dependency and keeps this project's habit of
 * adding none.
 *
 * Two transports, because the two ways an operator actually has an MCP server
 * are different:
 *
 * - **http** — a hosted server, reached with a URL and a token. Works on any
 *   host, including serverless.
 * - **stdio** — a server run as a local process. Needs a machine you control,
 *   and it executes a command, so it is behind an explicit opt-in (see
 *   `commandsAllowed`).
 */

/** Protocol revision we speak. Servers negotiate down if they are older. */
const PROTOCOL_VERSION = "2025-06-18";

const CLIENT_INFO = { name: "houseaimage", version: "0.1.0" };

/** A tool call that never answers must not hold a batch open forever. */
const DEFAULT_TIMEOUT_MS = 120_000;

export interface McpStdioConfig {
  kind: "stdio";
  command: string;
  args?: string[];
}

export interface McpHttpConfig {
  kind: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpConfig = McpStdioConfig | McpHttpConfig;

export class McpError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "McpError";
    this.code = code;
  }
}

/**
 * Running a command the operator typed is arbitrary code execution on the
 * server, and this app's settings panel is reachable by anyone who is past the
 * access gate. So local processes are refused unless the host explicitly opts
 * in, and the interface says so rather than failing mysteriously.
 */
export function commandsAllowed(): boolean {
  const raw = process.env.ENGINE_ALLOW_COMMANDS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** The shape a tool call comes back in. */
export interface McpToolResult {
  /** Parsed `structuredContent` when the server sent one. */
  structured?: unknown;
  /** Concatenated text blocks, for servers that answer in prose or JSON text. */
  text: string;
  isError: boolean;
}

export class McpClient {
  private readonly config: McpConfig;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  /** stdio state. */
  private child?: ChildProcessWithoutNullStreams;
  private buffer = "";

  /** http state: the session the server handed us at initialize. */
  private sessionId?: string;

  private handshake?: Promise<void>;

  constructor(config: McpConfig) {
    this.config = config;
  }

  /** Ends the connection. Safe to call more than once. */
  close(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new McpError("Conexión MCP cerrada"));
      this.pending.delete(id);
    }

    this.child?.kill();
    this.child = undefined;
    this.handshake = undefined;
    this.sessionId = undefined;
  }

  async listTools(): Promise<string[]> {
    const result = (await this.request("tools/list", {})) as {
      tools?: { name?: string }[];
    };

    return (result.tools ?? [])
      .map((tool) => tool.name)
      .filter((name): name is string => typeof name === "string");
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<McpToolResult> {
    const raw = (await this.request("tools/call", {
      name,
      arguments: args,
    })) as {
      content?: { type?: string; text?: string }[];
      structuredContent?: unknown;
      isError?: boolean;
    };

    const text = (raw.content ?? [])
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");

    return {
      structured: raw.structuredContent,
      text,
      isError: Boolean(raw.isError),
    };
  }

  /** Handshake once, then reuse. Concurrent callers await the same promise. */
  private ensureReady(): Promise<void> {
    this.handshake ??= this.initialize();
    return this.handshake;
  }

  private async initialize(): Promise<void> {
    if (this.config.kind === "stdio") this.startChild();

    await this.send("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });

    // A notification, so no id and no reply to wait for.
    await this.notify("notifications/initialized", {});
  }

  private async request(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    await this.ensureReady();
    return this.send(method, params);
  }

  private send(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };

    if (this.config.kind === "http") return this.sendHttp(message);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(`El servidor MCP no respondió a "${method}" a tiempo`));
      }, DEFAULT_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.child!.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new McpError(err instanceof Error ? err.message : "Escritura fallida"));
      }
    });
  }

  private async notify(
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    const message = { jsonrpc: "2.0", method, params };

    if (this.config.kind === "http") {
      await this.post(message);
      return;
    }

    this.child?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  // --- stdio ---------------------------------------------------------------

  private startChild(): void {
    if (this.child) return;

    if (!commandsAllowed()) {
      throw new McpError(
        "Ejecutar un servidor MCP local está desactivado. Pon ENGINE_ALLOW_COMMANDS=1 " +
          "en el servidor si de verdad quieres que esta aplicación lance procesos."
      );
    }

    const { command, args = [] } = this.config as McpStdioConfig;

    // `shell: false` is the default and stays that way on purpose: with a
    // shell, a configured command becomes an injection point.
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consume(chunk));

    // The server's own logging goes to stderr by protocol. Swallow it rather
    // than letting a chatty server flood the host's output.
    child.stderr.resume();

    child.on("exit", (code) => {
      this.rejectAll(new McpError(`El servidor MCP terminó (código ${code ?? "?"})`));
      this.child = undefined;
      this.handshake = undefined;
    });

    child.on("error", (err) => {
      this.rejectAll(new McpError(`No se pudo lanzar el servidor MCP: ${err.message}`));
      this.child = undefined;
      this.handshake = undefined;
    });

    this.child = child;
  }

  /** Newline-delimited JSON, which may arrive split across chunks. */
  private consume(chunk: string): void {
    this.buffer += chunk;

    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.dispatch(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private dispatch(line: string): void {
    let message: { id?: number; result?: unknown; error?: { code?: number; message?: string } };

    try {
      message = JSON.parse(line);
    } catch {
      // Servers that print a banner before speaking protocol are common
      // enough that this must not be fatal.
      return;
    }

    if (typeof message.id !== "number") return;

    const pending = this.pending.get(message.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new McpError(message.error.message ?? "Error MCP", message.error.code));
      return;
    }

    pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  // --- streamable http -----------------------------------------------------

  private async sendHttp(message: Record<string, unknown>): Promise<unknown> {
    const body = await this.post(message);

    if (body?.error) {
      throw new McpError(body.error.message ?? "Error MCP", body.error.code);
    }

    return body?.result;
  }

  private async post(message: Record<string, unknown>): Promise<{
    result?: unknown;
    error?: { code?: number; message?: string };
  } | null> {
    const { url, headers = {} } = this.config as McpHttpConfig;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Streamable HTTP lets the server answer either way, so we accept both.
        Accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        ...headers,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    // Handed out at initialize and required on every later call.
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new McpError(
        `El servidor MCP respondió ${response.status}: ${detail.slice(0, 300)}`,
        response.status
      );
    }

    // A notification gets a 202 with no body.
    if (response.status === 202) return null;

    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    if (!raw.trim()) return null;

    return contentType.includes("text/event-stream")
      ? parseEventStream(raw)
      : JSON.parse(raw);
  }
}

/**
 * Pull the last JSON-RPC message out of an SSE body.
 *
 * The server may stream progress notifications before the reply; the reply is
 * the last `data:` frame that carries a result or an error.
 */
function parseEventStream(raw: string): {
  result?: unknown;
  error?: { code?: number; message?: string };
} | null {
  let last: { result?: unknown; error?: unknown } | null = null;

  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;

    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    try {
      const message = JSON.parse(payload);
      if ("result" in message || "error" in message) last = message;
    } catch {
      /* A frame we cannot parse is a frame we do not need. */
    }
  }

  return last as { result?: unknown; error?: { code?: number; message?: string } } | null;
}
