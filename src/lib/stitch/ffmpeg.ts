import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Reel } from "@/types/video";
import type { StitchOptions, StitchProvider, StitchResult } from "@/types/stitch";
import { getStorage } from "@/lib/storage";
import { STITCH_TIMEOUT_MS } from "@/lib/config";
import { hasEndCardContent, renderEndCard } from "@/lib/stitch/endcard";

const run = promisify(execFile);

/**
 * Assemble the clips into one MP4 with ffmpeg.
 *
 * Three decisions worth knowing:
 *
 * - **Clips are re-encoded, not stream-copied.** A straight concat is far
 *   faster but only works when every input shares a codec, resolution and
 *   frame rate. Ours come back from a video model one job at a time and drift
 *   apart, and a concat that fails on the customer's tenth listing is worse
 *   than one that always takes a few seconds.
 * - **Every clip is letterboxed to the reel's aspect ratio** rather than
 *   cropped, because cropping a property photo cuts off the room.
 * - **Branding never fails the render.** A logo that will not download or a
 *   closing card that will not draw costs the branding, not the video: the
 *   customer has already paid to render these clips.
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

/** How long the closing card holds. Long enough to read a phone number. */
const END_CARD_SECONDS = 2.5;

async function download(url: string, destination: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`No se pudo descargar el clip (${res.status}): ${url}`);
  }
  await writeFile(destination, Buffer.from(await res.arrayBuffer()));
}

/**
 * Make a stored URL fetchable from the server itself.
 *
 * Photos and logos come back from `StorageProvider` as site-relative paths on
 * the local driver, and ffmpeg has no site to be relative to. `APP_URL` is what
 * an object-store driver makes unnecessary — until then, set it in production.
 */
function absolute(url: string): string {
  if (!url.startsWith("/")) return url;
  const origin = process.env.APP_URL?.trim() || "http://localhost:3000";
  return `${origin.replace(/\/+$/, "")}${url}`;
}

export const ffmpegStitchProvider: StitchProvider = {
  name: "ffmpeg",

  async isAvailable(): Promise<boolean> {
    // A binary with no usable video encoder is no better than no binary: the
    // caller falls back to the playlist rather than failing a batch that is
    // otherwise finished.
    return (await encoding()) !== null;
  },

  async stitch(reel: Reel, options: StitchOptions = {}): Promise<StitchResult> {
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

    const brand = options.brand;
    const { width, height } = dimensionsFor(reel.aspectRatio);
    const workDir = await mkdtemp(path.join(tmpdir(), "houseaimage-reel-"));

    try {
      const inputArgs: string[] = [];

      for (const [i, segment] of sources.entries()) {
        const file = path.join(workDir, `clip-${i}.mp4`);
        await download(segment.videoUrl!, file);
        inputArgs.push("-i", file);
      }

      const clipCount = sources.length;

      // Branding is attempted, never required. A block that fails returns
      // `undefined` and the graph below simply omits that stage.
      const endCardIndex = await addEndCard(brand, workDir, width, height, inputArgs);
      const logoIndex = await addLogo(brand, workDir, inputArgs);

      // Normalise each input, then concatenate. `force_original_aspect_ratio`
      // plus `pad` letterboxes instead of cropping; `setsar=1` stops a clip
      // with odd pixel aspect from skewing the rest.
      const normalise = (index: number, label: string) =>
        `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[${label}]`;

      const steps: string[] = [];
      for (let i = 0; i < clipCount; i++) steps.push(normalise(i, `v${i}`));

      const clipLabels = Array.from({ length: clipCount }, (_, i) => `[v${i}]`).join("");
      steps.push(`${clipLabels}concat=n=${clipCount}:v=1:a=0[body]`);

      let last = "body";

      if (logoIndex !== undefined) {
        // A twelfth of the frame, inset by a fortieth: present, not shouting.
        const logoWidth = Math.round(width / 12);
        const inset = Math.round(width / 40);
        steps.push(`[${logoIndex}:v]scale=${logoWidth}:-1,format=rgba,` +
          `colorchannelmixer=aa=0.75[wm]`);
        steps.push(
          `[${last}][wm]overlay=W-w-${inset}:H-h-${inset}:format=auto[branded]`
        );
        last = "branded";
      }

      if (endCardIndex !== undefined) {
        // The card is appended after the watermark stage, so the mark does not
        // sit on top of the logo it is a copy of.
        steps.push(normalise(endCardIndex, "card"));
        steps.push(`[${last}][card]concat=n=2:v=1:a=0[out]`);
        last = "out";
      }

      const output = path.join(workDir, `reel.${format.extension}`);

      await run(
        ffmpegPath(),
        [
          "-y",
          ...inputArgs,
          "-filter_complex",
          steps.join(";"),
          "-map",
          `[${last}]`,
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

/**
 * Draw the closing card and add it as a still input.
 *
 * `-loop 1 -t` turns a PNG into a clip of that length. Returns the input index
 * it took, or `undefined` when there is no card to draw or drawing failed.
 */
async function addEndCard(
  brand: StitchOptions["brand"],
  workDir: string,
  width: number,
  height: number,
  inputArgs: string[]
): Promise<number | undefined> {
  if (!brand || !hasEndCardContent(brand)) return undefined;

  try {
    const png = await renderEndCard(
      { ...brand, logoUrl: brand.logoUrl ? absolute(brand.logoUrl) : undefined },
      width,
      height
    );
    const file = path.join(workDir, "endcard.png");
    await writeFile(file, png);

    const index = inputArgs.filter((arg) => arg === "-i").length;
    inputArgs.push("-loop", "1", "-t", String(END_CARD_SECONDS), "-i", file);
    return index;
  } catch {
    // No card is a worse video, not a failed one.
    return undefined;
  }
}

/** Fetch the logo for the watermark. Returns the input index it took. */
async function addLogo(
  brand: StitchOptions["brand"],
  workDir: string,
  inputArgs: string[]
): Promise<number | undefined> {
  if (!brand?.watermark || !brand.logoUrl) return undefined;

  try {
    const file = path.join(workDir, "logo");
    await download(absolute(brand.logoUrl), file);

    const index = inputArgs.filter((arg) => arg === "-i").length;
    inputArgs.push("-i", file);
    return index;
  } catch {
    return undefined;
  }
}
