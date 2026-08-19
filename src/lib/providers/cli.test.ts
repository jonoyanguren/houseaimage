import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliPlugin } from "@/lib/providers/higgsfield-cli";
import { splitArgs } from "@/lib/providers/args";
import type { ResolvedPrompt } from "@/types/video";

/**
 * The command-line bridge, driven against a real process.
 *
 * The contract is the product here — "JSON on stdin, JSON on stdout" is what
 * an operator writes their wrapper against — so the test *is* a reference
 * implementation of it. It runs under Node, which every host of this app has
 * by definition.
 */

let workDir = "";
let bridge = "";

const ORIGINAL_ALLOW = process.env.ENGINE_ALLOW_COMMANDS;

/**
 * A wrapper exactly as the contract describes, plus the two things a real one
 * does that break naive parsing: it logs to stdout before answering, and it
 * writes progress to stderr.
 */
const BRIDGE = `
import { readFileSync } from "node:fs";

const [verb, id] = process.argv.slice(2);
console.error("bridge: arrancando");

if (verb === "create") {
  const input = JSON.parse(readFileSync(0, "utf8"));
  console.log("bridge: recibido " + input.imageUrl);
  console.log(JSON.stringify({ id: "job-" + input.aspectRatio, status: "queued" }));
} else if (verb === "status") {
  if (id === "listo") {
    console.log(JSON.stringify({ status: "completed", videoUrl: "https://cdn.test/a.mp4" }));
  } else if (id === "vacio") {
    console.log(JSON.stringify({ status: "completed" }));
  } else if (id === "roto") {
    console.log(JSON.stringify({ status: "failed", error: "el render se cayó" }));
  } else {
    console.log(JSON.stringify({ status: "processing", progress: 42 }));
  }
} else {
  console.log("no soy JSON");
}
`;

beforeAll(async () => {
  process.env.ENGINE_ALLOW_COMMANDS = "1";
  workDir = await mkdtemp(path.join(tmpdir(), "hai-cli-"));
  bridge = path.join(workDir, "bridge.mjs");
  await writeFile(bridge, BRIDGE, "utf8");
});

afterAll(async () => {
  if (ORIGINAL_ALLOW === undefined) delete process.env.ENGINE_ALLOW_COMMANDS;
  else process.env.ENGINE_ALLOW_COMMANDS = ORIGINAL_ALLOW;
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

const resolved: ResolvedPrompt = {
  prompt: "smooth horizontal pan along the countertop",
  negative: "no people",
  styleId: "tour",
  sceneType: "cocina",
  propertyType: "piso",
  aspectRatio: "16:9",
  durationSeconds: 5,
};

/** The script path is quoted because a Windows temp path contains spaces. */
function provider() {
  return cliPlugin.create({ command: process.execPath, args: `"${bridge}"` });
}

describe("splitArgs", () => {
  it("keeps a quoted path in one piece", () => {
    expect(splitArgs('--config "C:\\Program Files\\x.json" --v')).toEqual([
      "--config",
      "C:\\Program Files\\x.json",
      "--v",
    ]);
  });

  it("is empty for nothing at all", () => {
    expect(splitArgs(undefined)).toEqual([]);
    expect(splitArgs("   ")).toEqual([]);
  });
});

describe("cli plugin", () => {
  it("hands the resolved job to the command and reads its answer", async () => {
    const job = await provider().createClipJob({
      imageUrl: "https://example.test/cocina.jpg",
      resolved,
    });

    // The id echoes the aspect ratio, which proves the payload arrived whole.
    expect(job).toMatchObject({ providerJobId: "job-16:9", status: "queued" });
  });

  it("ignores a chatty binary and takes the JSON", async () => {
    // The bridge logs a line before answering, which a naive parse would choke
    // on — and every real wrapper does this.
    const status = await provider().getClipJobStatus("listo");

    expect(status).toMatchObject({
      status: "completed",
      videoUrl: "https://cdn.test/a.mp4",
    });
  });

  it("reports progress while a job runs", async () => {
    expect(await provider().getClipJobStatus("cualquiera")).toMatchObject({
      status: "processing",
      progress: 42,
    });
  });

  it("treats finished-with-no-video as a failure", async () => {
    const status = await provider().getClipJobStatus("vacio");
    expect(status.status).toBe("failed");
  });

  it("passes the command's own error message through", async () => {
    const status = await provider().getClipJobStatus("roto");
    expect(status.failure?.message).toBe("el render se cayó");
  });

  it("calls a missing binary a permanent failure, not something to retry", async () => {
    const missing = cliPlugin.create({ command: path.join(workDir, "no-existe") });

    await expect(
      missing.createClipJob({ imageUrl: "https://example.test/a.jpg", resolved })
    ).rejects.toMatchObject({ kind: "invalid_input" });
  });

  it("refuses to run anything when the host has not opted in", async () => {
    // Running a command typed into the settings panel is arbitrary code
    // execution on the server. The opt-in is the only thing standing between
    // the two, so this test guards it.
    delete process.env.ENGINE_ALLOW_COMMANDS;

    try {
      await expect(
        provider().createClipJob({ imageUrl: "https://example.test/a.jpg", resolved })
      ).rejects.toMatchObject({ kind: "unauthorized" });

      const verification = await provider().verifyCredentials!();
      expect(verification.ok).toBe(false);
    } finally {
      process.env.ENGINE_ALLOW_COMMANDS = "1";
    }
  });
});
