/**
 * The generation engine's public surface.
 *
 * Everything outside this directory should import from here, not from the
 * modules inside it. Internally the engine is split by responsibility:
 *
 * - `pipeline`    orchestration and I/O — fan out, poll, re-submit
 * - `transitions` the one pure place that decides a clip's next state
 * - `policy`      the rules that cost money: what is worth retrying, and when
 * - `state`       batch state derived from its clips
 * - `serialize`   the projection onto what the API may return
 *
 * The split is deliberate: judgement lives in `policy` and `transitions` as
 * pure functions, and `pipeline` only carries out what they decide. Both
 * defects the audit found lived in the gap that existed when those decisions
 * were scattered through the orchestration.
 */

export {
  createBatch,
  refreshBatch,
  regenerateClip,
  retryFailedClips,
  ValidationError,
} from "@/lib/engine/pipeline";

export { deriveBatchStatus, isSettled, isUsable, willRetry } from "@/lib/engine/state";
export { isPermanent, isRetryDue, hasTimedOut, backoffFor } from "@/lib/engine/policy";
export { toPublicBatch, toPublicClip } from "@/lib/engine/serialize";
