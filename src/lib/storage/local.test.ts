import { describe, expect, it } from "vitest";
import { UPLOAD_KEY, UPLOAD_ROUTE, localStorageProvider, mimeFor } from "@/lib/storage/local";

/**
 * Storage keys, and the pattern that decides what may be read back.
 *
 * The pattern is the only thing standing between a URL and the filesystem, so
 * it is tested as the security boundary it is — not as a formatting detail.
 */

describe("save", () => {
  it("names the file itself, never after the client's", async () => {
    // The uploaded name is attacker-controlled and could carry a path or a
    // second extension.
    const stored = await localStorageProvider.save(
      new File([new Uint8Array([1, 2, 3])], "../../etc/passwd.jpg", { type: "image/jpeg" })
    );

    expect(stored.url.startsWith(`${UPLOAD_ROUTE}/`)).toBe(true);
    expect(stored.url).not.toContain("passwd");
    expect(UPLOAD_KEY.test(stored.key)).toBe(true);
  });

  it("takes the extension from the type, not the name", async () => {
    const stored = await localStorageProvider.save(
      new File([new Uint8Array([1])], "cualquier-cosa.exe", { type: "image/png" })
    );

    expect(stored.key.endsWith(".png")).toBe(true);
  });

  it("serves from a route, because public/ is captured at build time", async () => {
    // Written under public/ these files existed on disk and returned 404 in
    // production, so every deployed batch failed on photos the server could
    // read perfectly well.
    const stored = await localStorageProvider.save(
      new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" })
    );

    expect(stored.url.startsWith("/api/")).toBe(true);
  });
});

describe("UPLOAD_KEY", () => {
  it("accepts exactly what save generates", () => {
    expect(UPLOAD_KEY.test("593c538b-b3fa-4b51-8c6c-689d74df2ced.jpg")).toBe(true);
    expect(UPLOAD_KEY.test("593c538b-b3fa-4b51-8c6c-689d74df2ced.mp4")).toBe(true);
  });

  it("refuses anything that could leave the directory", () => {
    for (const key of [
      "../package.json",
      "..%2f..%2fpackage.json",
      "/etc/passwd",
      "593c538b-b3fa-4b51-8c6c-689d74df2ced.jpg/../../x",
      "package.json",
      "593c538b-b3fa-4b51-8c6c-689d74df2ced.sh",
      "",
    ]) {
      expect(UPLOAD_KEY.test(key), key).toBe(false);
    }
  });
});

describe("mimeFor", () => {
  it("serves each kind as itself", () => {
    expect(mimeFor("x.png")).toBe("image/png");
    expect(mimeFor("x.mp4")).toBe("video/mp4");
    // An SVG logo served as JPEG is a broken closing card.
    expect(mimeFor("x.svg")).toBe("image/svg+xml");
  });
});
