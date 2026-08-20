import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Serving a stored file back, and above all serving it in pieces.
 *
 * Range support is not a nicety here: a `<video>` asks for a file in slices,
 * and answering every slice with the whole thing and a `200` leaves Safari
 * refusing to play at all and everyone else unable to seek. The reels were
 * being produced correctly and never reaching the screen.
 */

const workDir = await mkdtemp(path.join(tmpdir(), "houseaimage-serve-"));
process.env.STORAGE_LOCAL_DIR = workDir;

const { GET } = await import("@/app/api/uploads/[key]/route");

const KEY = "593c538b-b3fa-4b51-8c6c-689d74df2ced.mp4";
const BODY = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

await writeFile(path.join(workDir, KEY), BODY);

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

/** The route's second argument, as Next hands it over. */
function ctx(key: string) {
  return { params: Promise.resolve({ key }) } as never;
}

function get(key: string, range?: string) {
  return GET(
    new Request("http://test/api/uploads/x", {
      headers: range ? { Range: range } : {},
    }),
    ctx(key)
  );
}

describe("whole file", () => {
  it("serves it, and says pieces are welcome", async () => {
    const res = await get(KEY);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    // Without this header a video element never even asks for a range.
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect((await res.arrayBuffer()).byteLength).toBe(BODY.length);
  });

  it("refuses a key that could leave the directory", async () => {
    expect((await get("../package.json")).status).toBe(400);
  });

  it("reports a missing file as missing", async () => {
    expect((await get("00000000-0000-0000-0000-000000000000.mp4")).status).toBe(404);
  });
});

describe("ranges", () => {
  it("answers a leading slice with 206 and the right window", async () => {
    const res = await get(KEY, "bytes=0-99");

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-99/${BODY.length}`);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it("serves the exact bytes asked for, not merely the right count", async () => {
    const res = await get(KEY, "bytes=500-509");
    const bytes = Buffer.from(await res.arrayBuffer());

    expect(bytes).toEqual(BODY.subarray(500, 510));
  });

  it("reads to the end when no end is given", async () => {
    const res = await get(KEY, "bytes=900-");

    expect(res.headers.get("content-range")).toBe(`bytes 900-999/${BODY.length}`);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it("treats a suffix range as the last N bytes", async () => {
    // `bytes=-50` means the final fifty, not the first fifty.
    const res = await get(KEY, "bytes=-50");
    const bytes = Buffer.from(await res.arrayBuffer());

    expect(res.headers.get("content-range")).toBe(`bytes 950-999/${BODY.length}`);
    expect(bytes).toEqual(BODY.subarray(950));
  });

  it("clamps an end past the file rather than failing", async () => {
    const res = await get(KEY, "bytes=990-99999");

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 990-999/${BODY.length}`);
  });

  it("refuses a start past the end with 416", async () => {
    const res = await get(KEY, "bytes=5000-6000");

    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${BODY.length}`);
  });

  it("ignores a header it cannot parse and serves the whole file", async () => {
    const res = await get(KEY, "paginas=1-2");

    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(BODY.length);
  });
});
