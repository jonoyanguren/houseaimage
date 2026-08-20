import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Batch } from "@/types/video";

/**
 * The batch store, which until now was the one subsystem with no tests at all
 * — and the one whose limitation the user actually felt: a reload lost the
 * reel they had just paid to render.
 *
 * Pointed at a scratch database before the module loads, so these never touch
 * the file a running app is using.
 */
const workDir = await mkdtemp(path.join(tmpdir(), "houseaimage-db-"));
process.env.DATABASE_PATH = path.join(workDir, "test.db");

const { sqliteBatchStore, recentBatches } = await import("@/lib/jobStore/sqlite");
const { getDb, __closeDb } = await import("@/lib/db");

afterAll(async () => {
  __closeDb();
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

beforeEach(() => {
  getDb().exec("DELETE FROM batches");
});

function batchOf(id: string, updatedAt = Date.now()): Batch {
  return {
    batchId: id,
    status: "completed",
    createdAt: updatedAt,
    updatedAt,
    clips: [],
  };
}

describe("keeping a batch", () => {
  it("gives back what was stored", async () => {
    await sqliteBatchStore.save(batchOf("b1"));
    expect((await sqliteBatchStore.get("b1"))?.batchId).toBe("b1");
  });

  it("survives the connection being closed and reopened", async () => {
    // The whole point: a restart used to lose the reel.
    await sqliteBatchStore.save(batchOf("persistente"));
    __closeDb();

    expect((await sqliteBatchStore.get("persistente"))?.status).toBe("completed");
  });

  it("replaces rather than duplicating on every poll", async () => {
    // A batch is saved on each refresh; twenty polls must not be twenty rows.
    await sqliteBatchStore.save(batchOf("b1"));
    await sqliteBatchStore.save({ ...batchOf("b1"), status: "partial" });

    expect((await sqliteBatchStore.get("b1"))?.status).toBe("partial");
    const { c } = getDb().prepare("SELECT COUNT(*) c FROM batches").get() as { c: number };
    expect(c).toBe(1);
  });

  it("reports an unknown batch as absent, not as an error", async () => {
    await expect(sqliteBatchStore.get("no-existe")).resolves.toBeUndefined();
  });

  it("forgets one on request", async () => {
    await sqliteBatchStore.save(batchOf("b1"));
    await sqliteBatchStore.delete("b1");

    expect(await sqliteBatchStore.get("b1")).toBeUndefined();
  });
});

describe("ageing out", () => {
  it("refuses one that is past its life, even before a sweep", async () => {
    const old = batchOf("viejo", Date.now() - 48 * 60 * 60_000);
    await sqliteBatchStore.save(old);

    // Enforced on read as well as swept in the background, so a batch cannot
    // come back from the dead between sweeps.
    expect(await sqliteBatchStore.get("viejo")).toBeUndefined();
  });

  it("keeps a recent one", async () => {
    await sqliteBatchStore.save(batchOf("nuevo", Date.now() - 60_000));
    expect(await sqliteBatchStore.get("nuevo")).toBeDefined();
  });
});

describe("recentBatches", () => {
  it("lists newest first, which is what a history screen needs", async () => {
    const now = Date.now();
    await sqliteBatchStore.save(batchOf("antiguo", now - 3_000));
    await sqliteBatchStore.save(batchOf("medio", now - 2_000));
    await sqliteBatchStore.save(batchOf("reciente", now - 1_000));

    expect(recentBatches().map((b) => b.batchId)).toEqual([
      "reciente",
      "medio",
      "antiguo",
    ]);
  });

  it("honours the limit", async () => {
    for (let i = 0; i < 5; i++) await sqliteBatchStore.save(batchOf(`b${i}`));
    expect(recentBatches(2)).toHaveLength(2);
  });

  it("skips a row it cannot read instead of failing the list", async () => {
    await sqliteBatchStore.save(batchOf("bueno"));
    getDb()
      .prepare("INSERT INTO batches (id, updated_at, payload) VALUES (?, ?, ?)")
      .run("roto", Date.now(), "{no es json");

    expect(recentBatches().map((b) => b.batchId)).toEqual(["bueno"]);
  });
});
