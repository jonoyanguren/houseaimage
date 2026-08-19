import type { ClipStatus } from "@/types/video";

/**
 * Map a backend's status vocabulary onto ours.
 *
 * Shared by every Higgsfield transport, because the vocabulary belongs to the
 * vendor rather than to the wire format — and because the rule below is one of
 * the pipeline's invariants and must not exist in two copies that can drift.
 *
 * **Anything unrecognised is `processing`, never `failed`.** Providers add
 * states over time. A clip wrongly marked failed can never recover; one
 * wrongly marked processing corrects itself on the next poll.
 */
export function normalizeStatus(raw: unknown): ClipStatus {
  const value = String(raw ?? "").toLowerCase();

  if (["completed", "succeeded", "success", "done", "finished", "complete"].includes(value)) {
    return "completed";
  }
  if (["failed", "error", "canceled", "cancelled", "rejected", "nsfw"].includes(value)) {
    return "failed";
  }
  if (["queued", "pending", "created", "waiting", "in_queue", "submitted"].includes(value)) {
    return "queued";
  }

  return "processing";
}
