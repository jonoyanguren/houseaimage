import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Reel } from "@/types/video";
import type { StitchProvider, StitchResult } from "@/types/stitch";
import { getStorage } from "@/lib/storage";
import { STITCH_TIMEOUT_MS } from "@/lib/config";

const run = promisify(execFile);

/**
 * Assemble the clips into one MP4 with ffmpeg.
 *
 * Two decisions worth knowing:
 *
 * - **Clips are re-encoded, not stream-copied.** A straight concat is far
 *   faster but only works when every input shares a codec, resolution and
 *   frame rate. Ours come back from a video model one job at a time and drift
 *   apart, and a concat that fails on the customer's tenth listing is worse
 *   than one that always takes a few seconds.
 * - **Every clip is letterboxed to the style's aspect ratio** rather than
 *   cropped, because cropping a property photo cuts off the room.
 */

/** Where the binary lives. Not always on PATH — hence the override. */
function ffmpegPath(): string {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

interface Encoding {
  codec: string;
  extension: string;
  mimeType: string;
  args: string[];
}

/**
 * H.264 in an MP4 is the only format that plays everywhere the customer will
 * send this — WhatsApp, Idealista, Instagram. It is what we want.
 *
 * But not every ffmpeg build ships libx264 (it is a separate, GPL-licensed
 * library), and a stripped build would otherwise fail at the last step of a
 * batch the customer already paid to render. So we probe, and fall back to
 * VP8/WebM, which is universally available and still gives them a file.
 *
 * ⚠️ WebM is a worse deliverable — several portals and WhatsApp handle it
 * poorly. Treat the fallback as a warning that the host needs a fuller ffmpeg,
 * not as an equivalent option.
 */
const H264: Encoding = {
  codec: "libx264",
  extension: "mp4",
  mimeType: "video/mp4",
  args: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"],
};

const VP8: Encoding = {
  codec: "libvpx",
  extension: "webm",
  mimeType: "video/webm",
  args: ["-c:v", "libvpx", "-b:v", "2M", "-pix_fmt", "yuv420p"],
};

let encodingProbe: Promise<Encoding | null> | undefined;

async function hasEncoder(codec: string): Promise<boolean> {
  try {
    const { stdout } = await run(ffmpegPath(), ["-encoders"], { timeout: 10_000 });
    return stdout.includes(` ${codec} `);
  } catch {
    return false;
  }
}

async function detectEncoding(): Promise<Encoding | null> {
  if (await hasEncoder(H264.codec)) return H264;
  if (await hasEncoder(VP8.codec)) return VP8;
  return null;
}

function encoding(): Promise<Encoding | null> {
  encodingProbe ??= detectEncoding();
  return encodingProbe;
}

/** Test seam: forget the cached encoder probe. */
export function __resetEncodingProbe() {
  encodingProbe = undefined;
}

/** Output size for the reel, from the style's aspect ratio. */
function dimensionsFor(aspectRatio: string): { width: number; height: number } {
  switch (aspectRatio) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "4:5":
      return { width: 1080, height: 1350 };
    case "1:1":
      return { width: 1080, height: 1080 };
    case "16:9":
    default:
      return { width: 1920, height: 1080 };
  }
}

async function download(url: string, destination: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`No se pudo descargar el clip (${res.status}): ${url}`);
  }
  await writeFile(destination, Buffer.from(await res.arrayBuffer()));
}

export const ffmpegStitchProvider: StitchProvider = {
  name: "ffmpeg",

  async isAvailable(): Promise<boolean> {
    // A binary with no usable video encoder is no better than no binary: the
    // caller falls back to the playlist rather than failing a batch that is
    // otherwise finished.
    return (await encoding()) !== null;
  },

  async stitch(reel: Reel, aspectRatio: string): Promise<StitchResult> {
    const sources = reel.segments.filter((s) => s.videoUrl);
    if (sources.length === 0) {
      throw new Error("No hay clips con vídeo que montar");
    }

    const format = await encoding();
    if (!format) {
      throw new Error(
        "ffmpeg no tiene ningún codificador de vídeo utilizable (ni libx264 ni libvpx)"
      );
    }

    const { width, height } = dimensionsFor(aspectRatio);
    const workDir = await mkdtemp(path.join(tmpdir(), "houseaimage-reel-"));

    try {
      const inputs: string[] = [];
      for (const [i, segment] of sources.entries()) {
        const file = path.join(workDir, `clip-${i}.mp4`);
        await download(segment.videoUrl!, file);
        inputs.push(file);
      }

      // Normalise each input, then concatenate. `force_original_aspect_ratio`
      // plus `pad` letterboxes instead of cropping; `setsar=1` stops a clip
      // with odd pixel aspect from skewing the rest.
      const filters = inputs
        .map(
          (_, i) =>
            `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
            `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
        )
        .join(";");

      const concat =
        inputs.map((_, i) => `[v${i}]`).join("") +
        `concat=n=${inputs.length}:v=1:a=0[out]`;

      const output = path.join(workDir, `reel.${format.extension}`);

      await run(
        ffmpegPath(),
        [
          "-y",
          ...inputs.flatMap((file) => ["-i", file]),
          "-filter_complex",
          `${filters};${concat}`,
          "-map",
          "[out]",
          ...format.args,
          // Puts the index at the front so the file starts playing before it
          // has fully downloaded — it will be watched over mobile data. MP4
          // only; WebM is already streamable.
          ...(format.extension === "mp4" ? ["-movflags", "+faststart"] : []),
          output,
        ],
        { timeout: STITCH_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }
      );

      const buffer = await readFile(output);
      const stored = await getStorage().save(
        new File([new Uint8Array(buffer)], `reel.${format.extension}`, {
          type: format.mimeType,
        })
      );

      return { url: stored.url, bytes: buffer.byteLength };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  },
};
