import { describe, expect, it } from "vitest";
import { MAX_CLIP_ATTEMPTS, RETRY_BACKOFF_MS } from "@/lib/config";
import { makeClip } from "@/lib/engine/fixtures";
import {
  backoffFor,
  hasTimedOut,
  isPermanent,
  isRetryDue,
  isSettled,
  willRetry,
} from "@/lib/engine/policy";
import { CLIP_TIMEOUT_MS } from "@/lib/config";

describe("permanence", () => {
  it("never retries a failure that cannot succeed", () => {
    // Re-sending a photo the provider rejected as invalid costs exactly as
    // much as a retry that could work, and can never produce a clip.
    expect(isPermanent("invalid_input")).toBe(true);
    expect(isPermanent("unauthorized")).toBe(true);
  });

  it("retries anything that might succeed later", () => {
    expect(isPermanent("rate_limited")).toBe(false);
    expect(isPermanent("provider_error")).toBe(false);
    expect(isPermanent("network")).toBe(false);
    expect(isPermanent("timeout")).toBe(false);
  });

  it("treats an unrecognised failure as worth retrying", () => {
    // Wrongly giving up on a recoverable clip costs more than one wasted go.
    expect(isPermanent("unknown")).toBe(false);
  });
});

describe("willRetry", () => {
  it("retries a transient failure that has attempts left", () => {
    expect(willRetry(makeClip(0, "failed", { attempts: 1 }))).toBe(true);
  });

  it("does not retry a permanent failure, even on the first attempt", () => {
    const rejected = makeClip(0, "failed", {
      attempts: 1,
      failureKind: "invalid_input",
    });

    expect(willRetry(rejected)).toBe(false);
    // And so the batch treats it as done rather than waiting on it.
    expect(isSettled(rejected)).toBe(true);
  });

  it("does not retry once the budget is spent", () => {
    expect(willRetry(makeClip(0, "failed", { attempts: MAX_CLIP_ATTEMPTS }))).toBe(false);
  });

  it("does not retry a clip that has not failed", () => {
    expect(willRetry(makeClip(0, "processing"))).toBe(false);
    expect(willRetry(makeClip(0, "completed"))).toBe(false);
  });
});

describe("isSettled", () => {
  it("does not consider a failure settled while a retry is pending", () => {
    // Otherwise the batch announces itself dead with work still to come.
    expect(isSettled(makeClip(0, "failed", { attempts: 1 }))).toBe(false);
  });

  it("settles a completed clip and an exhausted one", () => {
    expect(isSettled(makeClip(0, "completed"))).toBe(true);
    expect(isSettled(makeClip(0, "failed", { attempts: MAX_CLIP_ATTEMPTS }))).toBe(true);
  });
});

describe("backoff", () => {
  it("waits longer on each successive attempt", () => {
    const first = backoffFor(makeClip(0, "failed", { attempts: 1 }));
    const second = backoffFor(makeClip(0, "failed", { attempts: 2 }));

    expect(first).toBe(RETRY_BACKOFF_MS);
    expect(second).toBe(RETRY_BACKOFF_MS * 2);
  });

  it("gives a rate limit materially more room than a random failure", () => {
    // Coming back after the same short pause walks into the same wall.
    const throttled = backoffFor(
      makeClip(0, "failed", { attempts: 1, failureKind: "rate_limited" })
    );
    const ordinary = backoffFor(
      makeClip(0, "failed", { attempts: 1, failureKind: "provider_error" })
    );

    expect(throttled).toBeGreaterThan(ordinary);
  });

  it("holds the retry until the wait has elapsed", () => {
    const clip = makeClip(0, "failed", { attempts: 1, submittedAt: 0 });

    expect(isRetryDue(clip, RETRY_BACKOFF_MS - 1)).toBe(false);
    expect(isRetryDue(clip, RETRY_BACKOFF_MS)).toBe(true);
  });
});

describe("timeout", () => {
  it("times out a clip that has been running too long", () => {
    const running = makeClip(0, "processing", { submittedAt: 0 });

    expect(hasTimedOut(running, CLIP_TIMEOUT_MS - 1)).toBe(false);
    expect(hasTimedOut(running, CLIP_TIMEOUT_MS + 1)).toBe(true);
  });

  it("never times out a clip that already finished", () => {
    const done = makeClip(0, "completed", { submittedAt: 0 });
    expect(hasTimedOut(done, CLIP_TIMEOUT_MS * 10)).toBe(false);
  });
});
