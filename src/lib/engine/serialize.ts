import type { Batch, Clip, PublicBatch, PublicClip } from "@/types/video";
import { willRetry } from "@/lib/engine/policy";

/**
 * Project the engine's internal batch onto what the API is allowed to return.
 *
 * Until this existed the internal model *was* the HTTP response, so anything
 * added to the engine leaked straight to the browser — which is exactly why
 * the composed prompt could not be stored on a clip. With an explicit
 * projection the engine is free to keep whatever it needs.
 *
 * Withheld deliberately:
 * - `resolved` — the composed prompt. It is the product's actual craft, and in
 *   the response body it would sit one devtools tab away from anyone.
 * - `providerJobId` — an internal handle that only invites poking at the
 *   provider directly.
 * - the raw `failure` object — the UI gets the message, not our taxonomy.
 *
 * Added deliberately:
 * - `willRetry`, so the UI can say "reintentando" instead of showing a failure
 *   the engine is already about to fix by itself.
 */
export function toPublicClip(clip: Clip): PublicClip {
  // Destructured out rather than picked, so a new field on `Clip` has to be
  // considered here explicitly before it can reach the browser.
  const { resolved, providerJobId, failure, ...rest } = clip;
  void resolved;
  void providerJobId;

  return {
    ...rest,
    error: failure?.message,
    willRetry: willRetry(clip),
  };
}

export function toPublicBatch(batch: Batch): PublicBatch {
  const { clips, options, ...rest } = batch;

  return {
    ...rest,
    clips: clips.map(toPublicClip),
    styleId: options?.styleId,
    propertyType: options?.propertyType,
  };
}
