/**
 * Access gate.
 *
 * The app spends money on every batch, so an open URL is an open wallet. This
 * is the smallest thing that closes it without committing to an identity
 * vendor: one shared access code, a signed cookie, and no user accounts.
 *
 * It is deliberately *not* a user system. There is one code, so there is no
 * "who" — only "allowed in". When per-customer billing arrives this is the
 * seam it replaces, and `requireSession` is the only thing callers use.
 *
 * Signed with Web Crypto rather than `node:crypto`, because `proxy.ts` runs
 * outside the Node runtime and has to verify the same cookie.
 */

export const SESSION_COOKIE = "hai_session";

/** A week. Long enough not to annoy, short enough that a leaked cookie expires. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export function accessCode(): string | undefined {
  return process.env.APP_ACCESS_CODE?.trim() || undefined;
}

/** True when no code is configured, so the app is open to whoever reaches it. */
export function isGateOpen(): boolean {
  return !accessCode();
}

/**
 * Signing key.
 *
 * Falls back to the access code itself when `APP_SESSION_SECRET` is unset:
 * requiring two secrets to protect one door is how people end up setting
 * neither. Set both in production — rotating the secret then invalidates every
 * session without changing the code people type.
 */
function secret(): string {
  return process.env.APP_SESSION_SECRET?.trim() || accessCode() || "";
}

async function hmac(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison, so a wrong code can't be found one byte at a time. */
function equals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkAccessCode(candidate: string): boolean {
  const expected = accessCode();
  if (!expected) return true;
  return equals(candidate.trim(), expected);
}

/** Mint a cookie value carrying only its own expiry. There is no identity to carry. */
export async function issueSession(now = Date.now()): Promise<{
  value: string;
  expiresAt: Date;
}> {
  const expiresAt = now + SESSION_TTL_MS;
  const payload = String(expiresAt);

  return {
    value: `${payload}.${await hmac(payload)}`,
    expiresAt: new Date(expiresAt),
  };
}

/** Verify a cookie: signature first, then expiry. */
export async function isValidSession(
  value: string | undefined,
  now = Date.now()
): Promise<boolean> {
  if (isGateOpen()) return true;
  if (!value) return false;

  const separator = value.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);

  if (!equals(signature, await hmac(payload))) return false;

  const expiresAt = Number.parseInt(payload, 10);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

/** Cookie options shared by the routes that set and clear it. */
export function cookieOptions(expiresAt?: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}
