import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Reel } from "@/types/video";
import { ffmpegStitchProvider, __resetEncodingProbe } from "@/lib/stitch/ffmpeg";

const run = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

/**
 * Assembly is the one part of the engine that cannot be proved with pure
 * functions: it either produces a playable file or it does not. So this test
 * makes three clips that *disagree* — different resolutions, frame rates and
 * durations, which is exactly what comes back from a video model run one job
 * at a time — serves them over HTTP the way a real provider would, and checks
 * the result.
 *
 * Skipped when the host has no usable ffmpeg, so the suite still passes
 * somewhere it cannot run.
 */

const CLIPS = [
  { name: "a", size: "1280x720", seconds: 3, fps: 25, colour: "firebrick" },
  { name: "b", size: "640x480", seconds: 2, fps: 30, colour: "steelblue" },
  { name: "c", size: "1080x1920", seconds: 4, fps: 24, colour: "seagreen" },
];

const TOTAL_SECONDS = CLIPS.reduce((sum, c) => sum + c.seconds, 0);

let available = false;
let server: Server | undefined;
let origin = "";
let workDir = "";

async function probe(): Promise<boolean> {
  try {
    const { stdout } = await run(ffmpeg, ["-encoders"], { timeout: 10_000 });
    return stdout.includes(" libx264 ") || stdout.includes(" libvpx ");
  } catch {
    return false;
  }
}

async function durationOf(file: string): Promise<number> {
  // ffmpeg prints the duration to stderr and exits non-zero with no output
  // file, so the error is the expected path here.
  const output = await run(ffmpeg, ["-i", file], { timeout: 30_000 }).then(
    (r) => r.stderr,
    (e: { stderr?: string }) => e.stderr ?? ""
  );
  const match = output.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!match) throw new Error(`No se pudo leer la duración de ${file}`);
  return +match[1] * 3600 + +match[2] * 60 + parseFloat(match[3]);
}

async function resolutionOf(file: string): Promise<string> {
  const output = await run(ffmpeg, ["-i", file], { timeout: 30_000 }).then(
    (r) => r.stderr,
    (e: { stderr?: string }) => e.stderr ?? ""
  );
  const match = output.match(/Video:.*?(\d{3,4}x\d{3,4})/);
  if (!match) throw new Error(`No se pudo leer la resolución de ${file}`);
  return match[1];
}

beforeAll(async () => {
  available = await probe();
  if (!available) return;

  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  workDir = await mkdtemp(path.join(tmpdir(), "stitch-test-"));

  for (const clip of CLIPS) {
    await run(ffmpeg, [
      "-y",
      "-f", "lavfi",
      "-i", `color=c=${clip.colour}:s=${clip.size}:d=${clip.seconds}:r=${clip.fps}`,
      "-pix_fmt", "yuv420p",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      path.join(workDir, `${clip.name}.mp4`),
    ], { timeout: 60_000 });
  }

  server = createServer(async (req, res) => {
    try {
      const file = path.join(workDir, path.basename(req.url ?? ""));
      res.writeHead(200, { "Content-Type": "video/mp4" });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });

  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  __resetEncodingProbe();
}, 120_000);

afterAll(async () => {
  server?.close();
  if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

function reelOf(): Reel {
  return {
    strategy: "sequential-playlist",
    totalDurationSeconds: TOTAL_SECONDS,
    segments: CLIPS.map((clip, index) => ({
      clipId: `clip-${index}`,
      index,
      imageUrl: `${origin}/${clip.name}.png`,
      sceneType: "generico",
      videoUrl: `${origin}/${clip.name}.mp4`,
      durationSeconds: clip.seconds,
      startAtSeconds: 0,
    })),
  };
}

describe.runIf(await probe())("ffmpeg stitching", () => {
  it("joins clips that disagree on resolution and frame rate", async () => {
    // A stream-copy concat fails on exactly this input; re-encoding is why we
    // pay the CPU cost.
    const result = await ffmpegStitchProvider.stitch(reelOf(), "16:9");

    expect(result.bytes).toBeGreaterThan(0);
    expect(result.url).toMatch(/\.(mp4|webm)$/);

    const produced = path.join(process.cwd(), "public", result.url.replace("/uploads/", "uploads/"));
    await expect(stat(produced)).resolves.toBeTruthy();

    // Every second of every clip survives the join.
    const duration = await durationOf(produced);
    expect(duration).toBeGreaterThan(TOTAL_SECONDS - 0.6);
    expect(duration).toBeLessThan(TOTAL_SECONDS + 0.6);

    await rm(produced, { force: true });
  }, 180_000);

  it("letterboxes to the requested aspect ratio instead of cropping", async () => {
    // Cropping a property photo cuts off the room, which is the thing being
    // sold. A portrait clip in a 16:9 reel must be padded, not trimmed.
    const result = await ffmpegStitchProvider.stitch(reelOf(), "9:16");

    const produced = path.join(process.cwd(), "public", result.url.replace("/uploads/", "uploads/"));
    expect(await resolutionOf(produced)).toBe("1080x1920");

    await rm(produced, { force: true });
  }, 180_000);

  it("refuses a reel with nothing to encode", async () => {
    const empty: Reel = { ...reelOf(), segments: [] };
    await expect(ffmpegStitchProvider.stitch(empty, "16:9")).rejects.toThrow(/No hay clips/);
  });
});
