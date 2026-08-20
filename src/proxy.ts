import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, isGateOpen, isValidSession } from "@/lib/auth/session";

/**
 * Access gate (Next 16 calls this Proxy; it was Middleware before).
 *
 * With no `APP_ACCESS_CODE` set the app is open, so a fresh clone still runs
 * with no configuration. With one set, everything below is behind a signed
 * cookie — including the settings panel, which holds the provider key.
 *
 * `/api/uploads` is deliberately *not* gated: the engine reads those photos
 * with no cookie to present — it is the server fetching its own URL — and
 * gating them would break every real render. They are unguessable UUIDs, which
 * is the same protection a signed object-store URL gives; the reason to move to
 * one is that these never expire.
 */
export async function proxy(request: NextRequest) {
  if (isGateOpen()) return NextResponse.next();

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(session)) return NextResponse.next();

  // An API call gets a status it can act on; a page gets the door.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Acceso restringido" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/entrar";
  // Come back to whatever they were trying to open, once they are in.
  url.searchParams.set("volver", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Everything except:
     * - `/entrar` and `/api/auth`, or there would be no way to get in
     * - `/api/uploads`, which the engine fetches without a cookie
     * - Next's own assets and the metadata files
     */
    "/((?!entrar|api/auth|api/uploads|uploads|_next/static|_next/image|favicon.ico|icon.svg|opengraph-image|robots.txt).*)",
  ],
};
