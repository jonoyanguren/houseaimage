import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOllamaAnalyzer, listModels, __resetModelCache } from "@/lib/vision/ollama";
import { readAnswer } from "@/lib/vision/prompt";
import type { AnalyzablePhoto } from "@/types/vision";

/**
 * The vision driver, against a server we control.
 *
 * What is actually under test is the degradation. A classifier that is right
 * most of the time and catastrophic the rest is worse than no classifier: this
 * one has to come back with the filename guess whenever the model is down,
 * slow, unavailable, or confidently wrong — and never throw.
 */

interface Call {
  path: string;
  body: Record<string, unknown>;
}

const calls: Call[] = [];

/** Capabilities the fake server reports, per model. */
let caps: Record<string, string[]> = {
  "sees:latest": ["completion", "vision"],
  "thinks:latest": ["completion", "vision", "thinking"],
  "blind:latest": ["completion", "tools"],
};
/** What `/api/chat` answers with. */
let chatContent = '{"room":"cocina","discard":false}';
/** When set, `/api/chat` fails with this status. */
let chatStatus = 200;

let server: Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));

    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      const parsed = body ? JSON.parse(body) : {};
      calls.push({ path, body: parsed });

      if (path === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            models: Object.keys(caps).map((name) => ({ name, size: 1_000_000 })),
          })
        );
        return;
      }

      if (path === "/api/show") {
        const model = String(parsed.model ?? "");
        if (!caps[model]) {
          res.writeHead(404).end(JSON.stringify({ error: "not found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ capabilities: caps[model] }));
        return;
      }

      if (path === "/api/chat") {
        if (chatStatus !== 200) {
          res.writeHead(chatStatus).end(JSON.stringify({ error: "no" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: { content: chatContent } }));
        return;
      }

      res.writeHead(404).end();
    });
  });

  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => server?.close());

beforeEach(() => {
  calls.length = 0;
  chatContent = '{"room":"cocina","discard":false}';
  chatStatus = 200;
  caps = {
    "sees:latest": ["completion", "vision"],
    "thinks:latest": ["completion", "vision", "thinking"],
    "blind:latest": ["completion", "tools"],
  };
  __resetModelCache();
});

/** A photo whose filename says nothing, so only the model can improve on it. */
const photo: AnalyzablePhoto = {
  dataUrl: "data:image/jpeg;base64,SGVsbG8=",
  fileName: "IMG_2481.jpg",
  index: 4,
  total: 10,
  propertyType: "piso",
};

describe("readAnswer", () => {
  it("takes a room it recognises", () => {
    expect(readAnswer({ room: "cocina", discard: false }).sceneType).toBe("cocina");
  });

  it("refuses a room it does not, rather than passing it on", () => {
    // An invented id would reach the prompt resolver and pick a camera
    // movement at random.
    expect(readAnswer({ room: "buhardilla", discard: false }).sceneType).toBe("generico");
    expect(readAnswer({}).sceneType).toBe("generico");
  });

  it("only keeps a reason when something is being discarded", () => {
    expect(readAnswer({ room: "salon", discard: false, reason: "x" }).reason).toBeUndefined();
    expect(readAnswer({ room: "salon", discard: true, reason: "Es un plano" }).reason).toBe(
      "Es un plano"
    );
  });
});

describe("availability", () => {
  it("accepts a model that can see", async () => {
    const analyzer = createOllamaAnalyzer({ baseUrl, model: "sees:latest" });
    expect(await analyzer.isAvailable()).toBe(true);
  });

  it("refuses a text-only model", async () => {
    // Handing a photograph to one produces confident nonsense, not an error,
    // so it has to be caught here.
    const analyzer = createOllamaAnalyzer({ baseUrl, model: "blind:latest" });
    expect(await analyzer.isAvailable()).toBe(false);
  });

  it("refuses when no model is chosen, and when the server is not there", async () => {
    expect(await createOllamaAnalyzer({ baseUrl }).isAvailable()).toBe(false);
    expect(
      await createOllamaAnalyzer({ baseUrl: "http://127.0.0.1:1", model: "x" }).isAvailable()
    ).toBe(false);
  });
});

describe("analyze", () => {
  it("takes the model's answer over the filename", async () => {
    const analyzer = createOllamaAnalyzer({ baseUrl, model: "sees:latest" });
    const result = await analyzer.analyze(photo);

    expect(result).toMatchObject({ sceneType: "cocina", source: "vision" });
  });

  it("sends the image without its data-url prefix", async () => {
    const analyzer = createOllamaAnalyzer({ baseUrl, model: "sees:latest" });
    await analyzer.analyze(photo);

    const chat = calls.find((c) => c.path === "/api/chat")!;
    const messages = chat.body.messages as { images: string[] }[];
    expect(messages[0].images[0]).toBe("SGVsbG8=");
  });

  it("asks for structured output at temperature zero", async () => {
    // The same photograph must always land in the same room.
    const analyzer = createOllamaAnalyzer({ baseUrl, model: "sees:latest" });
    await analyzer.analyze(photo);

    const chat = calls.find((c) => c.path === "/api/chat")!;
    expect(chat.body.format).toBeDefined();
    expect(chat.body.options).toMatchObject({ temperature: 0 });
  });

  it("turns reasoning off, but only for a model that has it", async () => {
    // Sending the flag to a model without the capability is an error.
    const thinker = createOllamaAnalyzer({ baseUrl, model: "thinks:latest" });
    await thinker.analyze(photo);
    expect(calls.find((c) => c.path === "/api/chat")!.body.think).toBe(false);

    calls.length = 0;
    const plain = createOllamaAnalyzer({ baseUrl, model: "sees:latest" });
    await plain.analyze(photo);
    expect(calls.find((c) => c.path === "/api/chat")!.body.think).toBeUndefined();
  });

  it("carries the discard warning and its reason", async () => {
    chatContent = '{"room":"generico","discard":true,"reason":"Es un plano de planta"}';
    const analyzer = createOllamaAnalyzer({ baseUrl, model: "sees:latest" });

    expect(await analyzer.analyze(photo)).toMatchObject({
      discard: true,
      reason: "Es un plano de planta",
      source: "vision",
    });
  });

  it("keeps the filename guess when the model abstains", async () => {
    // `generico` from the model is not better than a filename that may still
    // carry a real room name.
    chatContent = '{"room":"generico","discard":false}';
    const named = { ...photo, fileName: "cocina-2.jpg" };
    const analyzer = createOllamaAnalyzer({ baseUrl, model: "sees:latest" });

    expect(await analyzer.analyze(named)).toMatchObject({
      sceneType: "cocina",
      source: "heuristic",
    });
  });

  it("falls back rather than failing when the model errors", async () => {
    chatStatus = 500;
    const analyzer = createOllamaAnalyzer({ baseUrl, model: "sees:latest" });

    await expect(analyzer.analyze({ ...photo, fileName: "bano.jpg" })).resolves.toMatchObject(
      { sceneType: "bano", source: "heuristic" }
    );
  });

  it("falls back when the model answers with prose", async () => {
    chatContent = "Pues parece una cocina, diría yo.";
    const analyzer = createOllamaAnalyzer({ baseUrl, model: "sees:latest" });

    expect((await analyzer.analyze(photo)).source).toBe("heuristic");
  });

  it("falls back when the server is not running at all", async () => {
    const analyzer = createOllamaAnalyzer({
      baseUrl: "http://127.0.0.1:1",
      model: "sees:latest",
    });

    expect((await analyzer.analyze(photo)).source).toBe("heuristic");
  });
});

describe("listModels", () => {
  it("flags which models can see", async () => {
    const models = await listModels(baseUrl);

    expect(models.find((m) => m.name === "sees:latest")?.vision).toBe(true);
    expect(models.find((m) => m.name === "blind:latest")?.vision).toBe(false);
  });
});
