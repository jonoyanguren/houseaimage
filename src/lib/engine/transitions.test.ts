import { describe, expect, it } from "vitest";
import type { ProviderClipStatus } from "@/types/video";
import { CLIP_TIMEOUT_MS, RETRY_BACKOFF_MS } from "@/lib/config";
import { makeClip } from "@/lib/engine/fixtures";
import { adoptRetry, nextClipState, onPollError } from "@/lib/engine/transitions";

/**
 * `transitions` is the one place that decides a clip's next state, so it is
 * worth testing directly rather than only through the pipeline that calls it.
 */

const reading = (over: Partial<ProviderClipStatus> = {}): ProviderClipStatus => ({
  providerJobId: "job-0",
  status: "processing",
  ...over,
});

describe("nextClipState", () => {
  it("folds a provider reading into the clip", () => {
    const decision = nextClipState(
      makeClip(0, "queued"),
      reading({ status: "processing", progress: 42 }),
      0
    );

    expect(decision.type).toBe("keep");
    expect(decision.clip.status).toBe("processing");
    expect(decision.clip.progress).toBe(42);
  });

  it("clears a stale failure when the clip recovers", () => {
    // A clip that failed, was retried and is now running must not keep showing
    // the old error.
    const previouslyFailed = makeClip(0, "failed", { attempts: 1 });
    const decision = nextClipState(previouslyFailed, reading({ status: "processing" }), 0);

    expect(decision.clip.failure).toBeUndefined();
  });

  it("keeps the failure when the reading is itself a failure", () => {
    const decision = nextClipState(
      makeClip(0, "processing"),
      reading({
        status: "failed",
        failure: { kind: "provider_error", message: "render falló", at: 0 },
      }),
      0
    );

    expect(decision.clip.failure?.kind).toBe("provider_error");
  });

  it("times out a clip the provider never settles", () => {
    const decision = nextClipState(
      makeClip(0, "processing", { submittedAt: 0, attempts: 2 }),
      reading({ status: "processing" }),
      CLIP_TIMEOUT_MS + 1
    );

    expect(decision.clip.status).toBe("failed");
    expect(decision.clip.failure?.kind).toBe("timeout");
  });

  it("asks for a re-submission only once the backoff has elapsed", () => {
    const failed = makeClip(0, "failed", { attempts: 1, submittedAt: 0 });

    expect(nextClipState(failed, undefined, RETRY_BACKOFF_MS - 1).type).toBe("keep");
    expect(nextClipState(failed, undefined, RETRY_BACKOFF_MS).type).toBe("resubmit");
  });

  it("never asks to re-submit a permanent failure", () => {
    const rejected = makeClip(0, "failed", {
      attempts: 1,
      submittedAt: 0,
      failureKind: "invalid_input",
    });

    expect(nextClipState(rejected, undefined, CLIP_TIMEOUT_MS * 10).type).toBe("keep");
  });

  it("works with no reading at all, for a clip that never got a job id", () => {
    const neverEnqueued = makeClip(0, "failed", {
      attempts: 1,
      submittedAt: 0,
      providerJobId: "",
    });

    expect(nextClipState(neverEnqueued, undefined, RETRY_BACKOFF_MS).type).toBe("resubmit");
  });
});

describe("onPollError", () => {
  it("does not turn a network blip into a failed render", () => {
    // The job is very likely still running; spending an attempt would throw
    // away work that was going to succeed.
    const running = makeClip(0, "processing");
    const decision = onPollError(running, new Error("connection reset"), 5);

    expect(decision.type).toBe("keep");
    expect(decision.clip.status).toBe("processing");
    expect(decision.clip.attempts).toBe(running.attempts);
    expect(decision.clip.failure?.kind).toBe("network");
  });
});

describe("adoptRetry", () => {
  it("carries identity and position across a re-submission", () => {
    // A new clipId remounts the tile and makes the reel flicker; a changed
    // index reorders the finished video.
    const previous = makeClip(3, "failed", { attempts: 1 });
    const submitted = makeClip(99, "queued", { clipId: "brand-new" });

    const adopted = adoptRetry(previous, submitted);

    expect(adopted.clipId).toBe(previous.clipId);
    expect(adopted.index).toBe(3);
    expect(adopted.status).toBe("queued");
  });
});
