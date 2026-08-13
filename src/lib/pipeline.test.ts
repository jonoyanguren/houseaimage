import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateClipInput, VideoProvider } from "@/types/video";

/**
 * A provider we can steer, so the pipeline's own behaviour is what is under
 * test rather than the simulated provider's timing.
 */
const control = {
  failOnUrls: new Set<string>(),
  statuses: new Map<string, "queued" | "processing" | "completed" | "failed">(),
  created: [] as CreateClipInput[],
  jobSeq: 0,
};

const stubProvider: VideoProvider = {
  name: "stub",
  async createClipJob(input) {
    control.created.push(input);
    if (control.failOnUrls.has(input.imageUrl)) {
      throw new Error("provider refused the job");
    }
    return { providerJobId: `job-${++control.jobSeq}`, status: "queued" };
  },
  async getClipJobStatus(providerJobId) {
    const status = control.statuses.get(providerJobId) ?? "processing";
    return {
      providerJobId,
      status,
      videoUrl: status === "completed" ? "https://example.test/c.mp4" : undefined,
    };
  },
};

vi.mock("@/lib/providers", () => ({
  getVideoProvider: () => stubProvider,
}));

const { createBatch, refreshBatch, retryFailedClips, ValidationError } = await import(
  "@/lib/pipeline"
);

beforeEach(() => {
  control.failOnUrls.clear();
  control.statuses.clear();
  control.created = [];
  control.jobSeq = 0;
});

const photo = (n: number) => ({ imageUrl: `https://example.test/${n}.jpg` });

describe("createBatch — fan-out", () => {
  it("creates exactly one provider job per photo", async () => {
    const batch = await createBatch([photo(1), photo(2), photo(3)]);

    expect(control.created).toHaveLength(3);
    expect(batch.clips).toHaveLength(3);
    // One starting frame per job is the whole premise of the architecture.
    expect(control.created.every((c) => typeof c.imageUrl === "string")).toBe(true);
  });

  it("indexes clips by the user's photo order", async () => {
    const batch = await createBatch([photo(1), photo(2), photo(3)]);

    expect(batch.clips.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(batch.clips.map((c) => c.imageUrl)).toEqual([
      "https://example.test/1.jpg",
      "https://example.test/2.jpg",
      "https://example.test/3.jpg",
    ]);
  });

  it("resolves a prompt per clip from the batch's style and the photo's scene", async () => {
    await createBatch(
      [
        { imageUrl: "https://example.test/a.jpg", sceneType: "cocina" },
        { imageUrl: "https://example.test/b.jpg", sceneType: "bano" },
      ],
      { styleId: "cinematografico" }
    );

    expect(control.created[0].resolved.sceneType).toBe("cocina");
    expect(control.created[1].resolved.sceneType).toBe("bano");
    expect(control.created[0].resolved.prompt).not.toBe(
      control.created[1].resolved.prompt
    );
  });

  it("keeps one photo's failure from sinking the batch", async () => {
    control.failOnUrls.add("https://example.test/2.jpg");

    const batch = await createBatch([photo(1), photo(2), photo(3)]);

    expect(batch.clips.map((c) => c.status)).toEqual(["queued", "failed", "queued"]);
    expect(batch.status).toBe("processing");
    expect(batch.clips[1].error).toContain("provider refused");
  });

  it("starts every clip on its first attempt", async () => {
    const batch = await createBatch([photo(1)]);
    expect(batch.clips[0].attempts).toBe(1);
  });
});

describe("createBatch — validation", () => {
  it("rejects an empty batch", async () => {
    await expect(createBatch([])).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a relative image URL, which the provider could not fetch", async () => {
    await expect(
      createBatch([{ imageUrl: "/uploads/a.jpg" }])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an unknown scene type as a client bug", async () => {
    await expect(
      createBatch([{ imageUrl: "https://x.test/a.jpg", sceneType: "salón-raro" as never }])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a batch past the photo limit before spending anything", async () => {
    const many = Array.from({ length: 100 }, (_, i) => photo(i));

    await expect(createBatch(many)).rejects.toBeInstanceOf(ValidationError);
    expect(control.created).toHaveLength(0);
  });
});

describe("refreshBatch", () => {
  it("completes the batch and composes a reel once every clip lands", async () => {
    const batch = await createBatch([photo(1), photo(2)]);
    batch.clips.forEach((c) => control.statuses.set(c.providerJobId, "completed"));

    const refreshed = await refreshBatch(batch);

    expect(refreshed.status).toBe("completed");
    expect(refreshed.reel?.segments).toHaveLength(2);
  });

  it("leaves the reel unbuilt while a clip is still running", async () => {
    const batch = await createBatch([photo(1), photo(2)]);
    control.statuses.set(batch.clips[0].providerJobId, "completed");

    const refreshed = await refreshBatch(batch);

    expect(refreshed.status).toBe("processing");
    expect(refreshed.reel).toBeUndefined();
  });

  it("retries a failed clip automatically and keeps its identity", async () => {
    const batch = await createBatch([photo(1)]);
    const original = batch.clips[0];
    control.statuses.set(original.providerJobId, "failed");

    const refreshed = await refreshBatch(batch);
    const retried = refreshed.clips[0];

    // A new clipId would remount the tile and flicker in the UI.
    expect(retried.clipId).toBe(original.clipId);
    expect(retried.providerJobId).not.toBe(original.providerJobId);
    expect(retried.attempts).toBe(2);
  });

  it("stops retrying once the attempt budget is spent", async () => {
    const batch = await createBatch([photo(1)]);
    control.statuses.set(batch.clips[0].providerJobId, "failed");

    const once = await refreshBatch(batch);
    control.statuses.set(once.clips[0].providerJobId, "failed");
    const twice = await refreshBatch(once);

    expect(twice.clips[0].status).toBe("failed");
    expect(twice.status).toBe("failed");

    const before = control.created.length;
    await refreshBatch(twice);
    expect(control.created).toHaveLength(before);
  });

  it("never re-polls a clip that already completed", async () => {
    const batch = await createBatch([photo(1)]);
    control.statuses.set(batch.clips[0].providerJobId, "completed");

    const done = await refreshBatch(batch);
    const spy = vi.spyOn(stubProvider, "getClipJobStatus");
    await refreshBatch(done);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("builds a partial reel from the survivors", async () => {
    const batch = await createBatch([photo(1), photo(2)]);
    control.statuses.set(batch.clips[0].providerJobId, "completed");
    control.statuses.set(batch.clips[1].providerJobId, "failed");

    // Burn the automatic retry so the clip settles as failed.
    let current = await refreshBatch(batch);
    control.statuses.set(current.clips[1].providerJobId, "failed");
    current = await refreshBatch(current);

    expect(current.status).toBe("partial");
    expect(current.reel?.segments).toHaveLength(1);
    expect(current.reel?.segments[0].index).toBe(0);
  });
});

describe("retryFailedClips", () => {
  it("resubmits only the failed clips, sparing the ones already paid for", async () => {
    const batch = await createBatch([photo(1), photo(2)]);
    control.statuses.set(batch.clips[0].providerJobId, "completed");
    control.statuses.set(batch.clips[1].providerJobId, "failed");

    let current = await refreshBatch(batch);
    control.statuses.set(current.clips[1].providerJobId, "failed");
    current = await refreshBatch(current);

    const createdBefore = control.created.length;
    const retried = await retryFailedClips(current);

    expect(control.created).toHaveLength(createdBefore + 1);
    expect(retried.clips[0].status).toBe("completed");
    expect(retried.clips[1].attempts).toBe(1);
  });

  it("does nothing when there is nothing to rescue", async () => {
    const batch = await createBatch([photo(1)]);
    control.statuses.set(batch.clips[0].providerJobId, "completed");
    const done = await refreshBatch(batch);

    const createdBefore = control.created.length;
    await retryFailedClips(done);

    expect(control.created).toHaveLength(createdBefore);
  });
});
