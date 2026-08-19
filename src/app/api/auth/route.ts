import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  checkAccessCode,
  cookieOptions,
  isGateOpen,
  issueSession,
} from "@/lib/auth/session";
import { clientKey, rateLimit } from "@/lib/ratelimit";

/** Ten tries per IP per five minutes: generous for a typo, useless for a script. */
const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_MS = 5 * 60_000;

export async function POST(req: Request) {
  if (isGateOpen()) {
    return NextResponse.json(
      { error: "No hay ningún código de acceso configurado." },
      { status: 400 }
    );
  }

  const limit = rateLimit(`auth:${clientKey(req)}`, ATTEMPT_LIMIT, ATTEMPT_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Demasiados intentos. Prueba de nuevo en unos minutos." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let code = "";
  try {
    code = String(((await req.json()) as { code?: unknown }).code ?? "");
  } catch {
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  }

  if (!checkAccessCode(code)) {
    // No detail about what was wrong — there is only one secret to guess.
    return NextResponse.json({ error: "Código incorrecto" }, { status: 401 });
  }

  const session = await issueSession();
  const store = await cookies();
  store.set(SESSION_COOKIE, session.value, cookieOptions(session.expiresAt));

  return NextResponse.json({ ok: true });
}

/** Sign out. */
export async function DELETE() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", cookieOptions(new Date(0)));
  return NextResponse.json({ ok: true });
}
