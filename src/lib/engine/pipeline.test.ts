import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, CreateClipInput, VideoProvider } from "@/types/video";
import { CLIP_TIMEOUT_MS, RETRY_BACKOFF_MS } from "@/lib/config";
import { ProviderError } from "@/lib/providers/errors";

/**
 * A clock we control, so the retry backoff and the stuck-job timeout can be
 * exercised without the suite actually waiting minutes.
 */
let now = 1_700_000_000_000;
const advance = (ms: number) => {
  now += ms;
};
vi.spyOn(Date, "now").mockImplementation(() => now);
afterAll(() => vi.restoreAllMocks());

/**
 * A provider we can steer, so the pipeline's own behaviour is what is under
 * test rather than the simulated provider's timing.
 */
const control = {
  failOnUrls: new Set<string>(),
  /** Simulates the provider rejecting everything at once — a rate limit. */
  failAllCreates: false,
  /** A specific classified error to reject job creation with. */
  rejectWith: undefined as Error | undefined,
  /** Makes the status call throw, simulating a network blip. */
  throwOnPoll: false,
  statuses: new Map<string, "queued" | "processing" | "completed" | "failed">(),
  created: [] as CreateClipInput[],
  jobSeq: 0,
};

const stubProvider: VideoProvider = {
  name: "stub",
  async createClipJob(input) {
    control.created.push(input);
    if (control.rejectWith) throw control.rejectWith;
    if (control.failAllCreates || control.failOnUrls.has(input.imageUrl)) {
      throw new Error("provider refused the job");
    }
    return { providerJobId: `job-${++control.jobSeq}`, status: "queued" };
  },
  async getClipJobStatus(providerJobId) {
    if (control.throwOnPoll) throw new Error("connection reset");
    const status = control.statuses.get(providerJobId) ?? "processing";
    return {
      providerJobId,
      status,
      videoUrl: status === "completed" ? "https://example.test/c.mp4" : undefined,
    };
  },
};

// Only the provider *selection* is replaced. Mocking the whole module would
// also stub out the error classifier the pipeline relies on.
vi.mock("@/lib/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers")>()),
  getVideoProvider: () => stubProvider,
}));

const {
  createBatch,
  refreshBatch,
  regenerateClip,
  retryFailedClips,
  ValidationError,
} = await import("@/lib/engine/pipeline");

beforeEach(() => {
  control.failOnUrls.clear();
  control.failAllCreates = false;
  control.rejectWith = undefined;
  control.throwOnPoll = false;
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

    expect(batch.clips.map((c: Clip) => c.index)).toEqual([0, 1, 2]);
    expect(batch.clips.map((c: Clip) => c.imageUrl)).toEqual([
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

    expect(batch.clips.map((c: Clip) => c.status)).toEqual(["queued", "failed", "queued"]);
    expect(batch.status).toBe("processing");
    expect(batch.clips[1].failure?.message).toContain("provider refused");
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

/** Poll past the backoff window, so any due retry actually fires. */
async function pollAfterBackoff(batchId: string) {
  advance(RETRY_BACKOFF_MS * 8);
  const batch = await refreshBatch(batchId);
  if (!batch) throw new Error("batch vanished");
  return batch;
}

describe("refreshBatch", () => {
  it("404s on a batch that does not exist", async () => {
    await expect(refreshBatch("no-such-batch")).resolves.toBeUndefined();
  });

  it("completes the batch and composes a reel once every clip lands", async () => {
    const batch = await createBatch([photo(1), photo(2)]);
    batch.clips.forEach((c: Clip) => control.statuses.set(c.providerJobId, "completed"));

    const refreshed = await refreshBatch(batch.batchId);

    expect(refreshed?.status).toBe("completed");
    expect(refreshed?.reel?.segments).toHaveLength(2);
  });

  it("leaves the reel unbuilt while a clip is still running", async () => {
    const batch = await createBatch([photo(1), photo(2)]);
    control.statuses.set(batch.clips[0].providerJobId, "completed");

    const refreshed = await refreshBatch(batch.batchId);

    expect(refreshed?.status).toBe("processing");
    expect(refreshed?.reel).toBeUndefined();
  });

  it("retries a failed clip automatically and keeps its identity", async () => {
    const batch = await createBatch([photo(1)]);
    const original = batch.clips[0];
    control.statuses.set(original.providerJobId, "failed");

    const retried = (await pollAfterBackoff(batch.batchId)).clips[0];

    // A new clipId would remount the tile and flicker in the UI.
    expect(retried.clipId).toBe(original.clipId);
    expect(retried.providerJobId).not.toBe(original.providerJobId);
    expect(retried.attempts).toBe(2);
  });

  it("reports the batch as still running while a retry is pending", async () => {
    // The defect this replaces: the batch announced itself failed with an
    // automatic retry still to come, and clients gave up on recoverable work.
    control.failAllCreates = true;
    const batch = await createBatch([photo(1), photo(2)]);
    control.failAllCreates = false;

    expect(batch.clips.every((c: Clip) => c.status === "failed")).toBe(true);
    expect(batch.clips.every((c: Clip) => c.attempts === 1)).toBe(true);
    expect(batch.status).toBe("processing");
  });

  it("waits before re-submitting, instead of walking back into the rate limit", async () => {
    const batch = await createBatch([photo(1)]);
    control.statuses.set(batch.clips[0].providerJobId, "failed");

    const createdBefore = control.created.length;
    const tooSoon = await refreshBatch(batch.batchId);

    expect(control.created).toHaveLength(createdBefore); // nothing re-sent yet
    expect(tooSoon?.clips[0].attempts).toBe(1);
    expect(tooSoon?.status).toBe("processing");

    const later = await pollAfterBackoff(batch.batchId);
    expect(control.created).toHaveLength(createdBefore + 1);
    expect(later.clips[0].attempts).toBe(2);
  });

  it("gives a hung clip one more go instead of polling it forever", async () => {
    const batch = await createBatch([photo(1)]);
    const original = batch.clips[0];
    control.statuses.set(original.providerJobId, "processing");

    advance(CLIP_TIMEOUT_MS + 1_000);
    const after = await refreshBatch(batch.batchId);

    // Timing out makes it retryable, so the clip is re-submitted rather than
    // left spinning against a provider that will never answer.
    expect(after?.clips[0].providerJobId).not.toBe(original.providerJobId);
    expect(after?.clips[0].attempts).toBe(2);
  });

  it("gives up on a hung clip once it has no attempts left, with a clear reason", async () => {
    const batch = await createBatch([photo(1)]);
    control.statuses.set(batch.clips[0].providerJobId, "processing");

    advance(CLIP_TIMEOUT_MS + 1_000);
    await refreshBatch(batch.batchId); // times out, retries
    advance(CLIP_TIMEOUT_MS + 1_000);
    const dead = await refreshBatch(batch.batchId); // times out, budget spent

    expect(dead?.clips[0].status).toBe("failed");
    expect(dead?.clips[0].failure?.kind).toBe("timeout");
    expect(dead?.clips[0].failure?.message).toMatch(/no terminó/i);
    // The user is told the render hung, not that the batch mysteriously expired.
    expect(dead?.status).toBe("failed");
  });

  it("stops retrying once the attempt budget is spent", async () => {
    const batch = await createBatch([photo(1)]);
    control.statuses.set(batch.clips[0].providerJobId, "failed");

    const once = await pollAfterBackoff(batch.batchId);
    control.statuses.set(once.clips[0].providerJobId, "failed");
    const twice = await pollAfterBackoff(batch.batchId);

    expect(twice.clips[0].status).toBe("failed");
    expect(twice.status).toBe("failed");

    const before = control.created.length;
    await pollAfterBackoff(batch.batchId);
    expect(control.created).toHaveLength(before);
  });

  it("never re-polls a clip that already completed", async () => {
    const batch = await createBatch([photo(1)]);
    control.statuses.set(batch.clips[0].providerJobId, "completed");

    await refreshBatch(batch.batchId);
    const spy = vi.spyOn(stubProvider, "getClipJobStatus");
    await refreshBatch(batch.batchId);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("builds a partial reel from the survivors", async () => {
    const batch = await createBatch([photo(1), photo(2)]);
    control.statuses.set(batch.clips[0].providerJobId, "completed");
    control.statuses.set(batch.clips[1].providerJobId, "failed");

    // Burn the automatic retry so the clip settles as failed.
    const once = await pollAfterBackoff(batch.batchId);
    control.statuses.set(once.clips[1].providerJobId, "failed");
    const current = await pollAfterBackoff(batch.batchId);

    expect(current.status).toBe("partial");
    expect(current.reel?.segments).toHaveLength(1);
    expect(current.reel?.segments[0].index).toBe(0);
  });
});

describe("failure classification", () => {
  it("does not pay to retry a photo the provider rejected outright", async () => {
    // A 4xx means the input is unusable; re-sending it bills the customer
    // again for a clip that cannot exist.
    control.rejectWith = new ProviderError("invalid_input", "unsupported image", 415);
    const batch = await createBatch([photo(1)]);
    control.rejectWith = undefined;

    expect(batch.clips[0].failure?.kind).toBe("invalid_input");
    expect(batch.status).toBe("failed"); // terminal immediately

    const createdBefore = control.created.length;
    await pollAfterBackoff(batch.batchId);

    expect(control.created).toHaveLength(createdBefore);
  });

  it("does retry a rate limit, which is only temporary", async () => {
    control.rejectWith = new ProviderError("rate_limited", "slow down", 429);
    const batch = await createBatch([photo(1)]);
    control.rejectWith = undefined;

    expect(batch.clips[0].failure?.kind).toBe("rate_limited");
    expect(batch.status).toBe("processing");

    const createdBefore = control.created.length;
    // Rate limits get a longer wait than an ordinary failure.
    advance(RETRY_BACKOFF_MS * 64);
    await refreshBatch(batch.batchId);

    expect(control.created).toHaveLength(createdBefore + 1);
  });

  it("keeps a clip running when the status call itself fails", async () => {
    // A network blip reading the status is not a failed render — spending an
    // attempt on it would throw away a job that is very likely still going.
    const batch = await createBatch([photo(1)]);
    control.throwOnPoll = true;

    const after = await refreshBatch(batch.batchId);

    expect(after?.clips[0].status).toBe("queued");
    expect(after?.clips[0].attempts).toBe(1);
    expect(after?.clips[0].failure?.kind).toBe("network");
    control.throwOnPoll = false;
  });
});

describe("concurrency", () => {
  it("does not pay twice when two tabs poll the same batch at once", async () => {
    // Two concurrent refreshes both used to see the same failed clip and both
    // re-submit it, billing the customer twice for one photo.
    const batch = await createBatch([photo(1)]);
    control.statuses.set(batch.clips[0].providerJobId, "failed");
    advance(RETRY_BACKOFF_MS * 8);

    const createdBefore = control.created.length;
    await Promise.all([
      refreshBatch(batch.batchId),
      refreshBatch(batch.batchId),
      refreshBatch(batch.batchId),
    ]);

    expect(control.created).toHaveLength(createdBefore + 1);
  });

  it("does not let a manual retry cross a poll", async () => {
    const batch = await createBatch([photo(1)]);
    control.statuses.set(batch.clips[0].providerJobId, "failed");
    advance(RETRY_BACKOFF_MS * 8);

    const createdBefore = control.created.length;
    await Promise.all([
      refreshBatch(batch.batchId),
      retryFailedClips(batch.batchId),
    ]);

    expect(control.created).toHaveLength(createdBefore + 1);
  });
});

describe("retryFailedClips", () => {
  it("resubmits only the failed clips, sparing the ones already paid for", async () => {
    const batch = await createBatch([photo(1), photo(2)]);
    control.statuses.set(batch.clips[0].providerJobId, "completed");
    control.statuses.set(batch.clips[1].providerJobId, "failed");

    const once = await pollAfterBackoff(batch.batchId);
    control.statuses.set(once.clips[1].providerJobId, "failed");
    await pollAfterBackoff(batch.batchId);

    const createdBefore = control.created.length;
    const retried = await retryFailedClips(batch.batchId);

    expect(control.created).toHaveLength(createdBefore + 1);
    expect(retried?.clips[0].status).toBe("completed");
    expect(retried?.clips[1].attempts).toBe(1);
  });

  it("does nothing when there is nothing to rescue", async () => {
    const batch = await createBatch([photo(1)]);
    control.statuses.set(batch.clips[0].providerJobId, "completed");
    await refreshBatch(batch.batchId);

    const createdBefore = control.created.length;
    await retryFailedClips(batch.batchId);

    expect(control.created).toHaveLength(createdBefore);
  });

  it("404s on a batch that does not exist", async () => {
    await expect(retryFailedClips("no-such-batch")).resolves.toBeUndefined();
  });
});

describe("regenerateClip — the user rejecting a shot", () => {
  it("re-submits a clip that finished perfectly well", async () => {
    const created = await createBatch([photo(1), photo(2)]);
    const target = created.clips[1];
    control.statuses.set(target.providerJobId, "completed");
    control.statuses.set(created.clips[0].providerJobId, "completed");

    const settled = await refreshBatch(created.batchId);
    expect(settled?.status).toBe("completed");

    const before = control.created.length;
    const regenerated = await regenerateClip(created.batchId, target.clipId);
    const clip = regenerated?.clips.find((c) => c.clipId === target.clipId);

    // Exactly one new job: this action costs one render, not a whole batch.
    expect(control.created.length).toBe(before + 1);
    expect(clip?.status).toBe("queued");
  });

  it("keeps clipId and index across the re-render", async () => {
    // `index` is the position in the finished video and `clipId` is what the
    // UI keys on — losing either is a reordered or flickering reel.
    const created = await createBatch([photo(1), photo(2), photo(3)]);
    const target = created.clips[1];

    const regenerated = await regenerateClip(created.batchId, target.clipId);
    const clip = regenerated?.clips.find((c) => c.clipId === target.clipId);

    expect(clip?.index).toBe(1);
    expect(clip?.imageUrl).toBe(target.imageUrl);
    expect(regenerated?.clips.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it("drops the assembled download, because the footage changed", async () => {
    const created = await createBatch([photo(1)]);
    control.statuses.set(created.clips[0].providerJobId, "completed");
    const settled = await refreshBatch(created.batchId);
    expect(settled?.reel).toBeDefined();

    const regenerated = await regenerateClip(created.batchId, created.clips[0].clipId);

    // A stale file would show the old shot the user just rejected.
    expect(regenerated?.reel).toBeUndefined();
    expect(regenerated?.status).toBe("processing");
  });

  it("resets the attempt counter, so the clip gets its own retries", async () => {
    const created = await createBatch([photo(1)]);
    const regenerated = await regenerateClip(created.batchId, created.clips[0].clipId);

    expect(regenerated?.clips[0].attempts).toBe(1);
  });

  it("rejects an unknown clip and reports an unknown batch", async () => {
    const created = await createBatch([photo(1)]);

    await expect(regenerateClip(created.batchId, "no-existe")).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(regenerateClip("no-existe", "tampoco")).resolves.toBeUndefined();
  });
});
