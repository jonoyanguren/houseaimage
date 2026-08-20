import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOpenAiAnalyzer } from "@/lib/vision/openai";
import type { AnalyzablePhoto } from "@/types/vision";

/**
 * The hosted classifier, against a server we control.
 *
 * It exists because the local driver ties the product to a machine with a GPU,
 * so this is the one that survives a deployment. What is under test is the
 * same thing as with the local one: the degradation. A classifier that is
 * right most of the time and catastrophic the rest is worse than none.
 */

let requests: { auth?: string; body: Record<string, unknown> }[] = [];
let content = '{"room":"cocina","discard":false}';
let status = 200;

let server: Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));

    req.on("end", () => {
      requests.push({
        auth: req.headers.authorization,
        body: JSON.parse(raw || "{}"),
      });

      if (status !== 200) {
        res.writeHead(status).end(JSON.stringify({ error: "no" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });

  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => server?.close());

beforeEach(() => {
  requests = [];
  content = '{"room":"cocina","discard":false}';
  status = 200;
});

/** A filename that says nothing, so only the model can improve on it. */
const photo: AnalyzablePhoto = {
  dataUrl: "data:image/jpeg;base64,SGVsbG8=",
  fileName: "IMG_2481.jpg",
  index: 4,
  total: 10,
  propertyType: "piso",
};

const analyzer = () =>
  createOpenAiAnalyzer({ baseUrl, model: "vision-mini", apiKey: "k-1234" });

describe("availability", () => {
  it("needs a model and a key, and says so without a round trip", async () => {
    // Discovering a half-filled configuration must not cost one request per
    // photograph.
    expect(await createOpenAiAnalyzer({ baseUrl }).isAvailable()).toBe(false);
    expect(
      await createOpenAiAnalyzer({ baseUrl, model: "m" }).isAvailable()
    ).toBe(false);
    expect(await analyzer().isAvailable()).toBe(true);
  });
});

describe("the request", () => {
  it("sends the key as a bearer", async () => {
    await analyzer().analyze(photo);
    expect(requests[0].auth).toBe("Bearer k-1234");
  });

  it("sends the photograph inline rather than as a link", async () => {
    // The vendor's network has no reason to be able to reach our server.
    await analyzer().analyze(photo);

    const messages = requests[0].body.messages as {
      content: { type: string; image_url?: { url: string } }[];
    }[];
    const image = messages[0].content.find((part) => part.type === "image_url");

    expect(image?.image_url?.url).toBe(photo.dataUrl);
  });

  it("asks for JSON at temperature zero, and caps the answer", async () => {
    await analyzer().analyze(photo);

    expect(requests[0].body).toMatchObject({
      temperature: 0,
      response_format: { type: "json_object" },
    });
    // Twenty tokens of JSON: a chatty model must not bill for an essay.
    expect(requests[0].body.max_tokens).toBeLessThanOrEqual(200);
  });
});

describe("the answer", () => {
  it("takes the model's room over the filename", async () => {
    expect(await analyzer().analyze(photo)).toMatchObject({
      sceneType: "cocina",
      source: "vision",
    });
  });

  it("carries a discard and its reason", async () => {
    content = '{"room":"generico","discard":true,"reason":"plano de planta"}';

    expect(await analyzer().analyze(photo)).toMatchObject({
      discard: true,
      reason: "plano de planta",
      source: "vision",
    });
  });

  it("keeps the filename guess when the model abstains", async () => {
    content = '{"room":"generico","discard":false}';

    expect(await analyzer().analyze({ ...photo, fileName: "cocina-2.jpg" })).toMatchObject(
      { sceneType: "cocina", source: "heuristic" }
    );
  });

  it("refuses a room it does not recognise", async () => {
    content = '{"room":"buhardilla","discard":true}';
    // An invented id would reach the prompt resolver and pick a camera
    // movement at random.
    expect((await analyzer().analyze(photo)).sceneType).toBe("generico");
  });
});

describe("when it goes wrong", () => {
  it("falls back on an error rather than failing the upload", async () => {
    status = 429;

    expect(
      await analyzer().analyze({ ...photo, fileName: "bano.jpg" })
    ).toMatchObject({ sceneType: "bano", source: "heuristic" });
  });

  it("falls back when the model answers with prose", async () => {
    content = "Parece una cocina, diría yo.";
    expect((await analyzer().analyze(photo)).source).toBe("heuristic");
  });

  it("falls back when the host is not there at all", async () => {
    const offline = createOpenAiAnalyzer({
      baseUrl: "http://127.0.0.1:1",
      model: "m",
      apiKey: "k",
    });

    expect((await offline.analyze(photo)).source).toBe("heuristic");
  });
});
