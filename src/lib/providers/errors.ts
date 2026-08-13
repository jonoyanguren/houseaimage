import type { ClipFailure, FailureKind } from "@/types/video";

/**
 * An error a provider raised, carrying its classification.
 *
 * Only the provider knows what its own status codes mean, so it is the
 * provider that classifies — the engine just acts on the verdict. Without
 * this, every failure looked alike and a photo the provider rejected outright
 * was retried exactly as eagerly as one that hit a rate limit.
 */
export class ProviderError extends Error {
  readonly kind: FailureKind;
  readonly status?: number;

  constructor(kind: FailureKind, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = status;
  }
}

/** Map an HTTP status onto a failure kind, the usual REST conventions. */
export function kindFromStatus(status: number): FailureKind {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "unauthorized";
  // 408 and 425 are the server asking us to come back, not a bad request.
  if (status === 408 || status === 425) return "provider_error";
  if (status >= 400 && status < 500) return "invalid_input";
  if (status >= 500) return "provider_error";
  return "unknown";
}

/**
 * Normalise anything thrown during a provider call into a stored failure.
 *
 * A `ProviderError` keeps its classification; an abort is a timeout; anything
 * else is assumed transient, because wrongly giving up costs more than one
 * wasted retry.
 */
export function toClipFailure(error: unknown, now: number): ClipFailure {
  if (error instanceof ProviderError) {
    return {
      kind: error.kind,
      message: error.message,
      status: error.status,
      at: now,
    };
  }

  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return { kind: "timeout", message: "El proveedor no respondió a tiempo", at: now };
  }

  return {
    kind: "network",
    message: error instanceof Error ? error.message : "No se pudo crear el trabajo",
    at: now,
  };
}
