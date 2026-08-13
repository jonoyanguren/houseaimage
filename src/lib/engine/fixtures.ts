import type { Clip, ClipStatus, FailureKind } from "@/types/video";
import { MAX_CLIP_ATTEMPTS } from "@/lib/config";
import { buildClipPrompt } from "@/lib/prompts";

/**
 * Test fixtures. Not imported by anything that ships — kept beside the engine
 * so the shape of a clip is declared once, and a field added to `Clip` breaks
 * here rather than in a dozen test files.
 */

interface ClipOverrides extends Partial<Omit<Clip, "failure">> {
  /** Shorthand: build the failure object from just its kind. */
  failureKind?: FailureKind;
}

/**
 * A clip in whatever state you ask for.
 *
 * Failures default to an exhausted attempt budget, so they are genuinely
 * terminal. A failure with attempts left is a *different* state — the batch is
 * still running — and tests that care say so explicitly.
 */
export function makeClip(
  index: number,
  status: ClipStatus,
  { failureKind, ...overrides }: ClipOverrides = {}
): Clip {
  const attempts = overrides.attempts ?? (status === "failed" ? MAX_CLIP_ATTEMPTS : 1);

  return {
    clipId: `clip-${index}`,
    index,
    imageUrl: `https://example.test/${index}.jpg`,
    sceneType: "generico",
    resolved: buildClipPrompt({ sceneType: "generico" }),
    providerJobId: `job-${index}`,
    status,
    attempts,
    submittedAt: 0,
    videoUrl: status === "completed" ? `https://example.test/${index}.mp4` : undefined,
    failure:
      status === "failed"
        ? { kind: failureKind ?? "provider_error", message: "boom", at: 0 }
        : undefined,
    ...overrides,
  };
}
