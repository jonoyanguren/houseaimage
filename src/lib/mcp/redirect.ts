/**
 * Where the authorisation server sends the browser back to.
 *
 * `APP_URL` wins when it is set, because behind a tunnel or a proxy the
 * request's own origin is the internal address and the authorisation server
 * would be redirecting the operator somewhere unreachable. Falling back to the
 * request origin is what makes this work on `localhost` with no configuration
 * at all — and localhost genuinely works here, because it is the *browser*
 * that follows the redirect, not the remote server.
 *
 * It has to be byte-identical between the authorise call and the exchange, or
 * the token endpoint refuses the code. One function, both callers.
 */
export const CALLBACK_PATH = "/api/settings/provider/callback";

export function callbackUrl(req: Request): string {
  const configured = process.env.APP_URL?.trim();
  const origin = configured ? configured.replace(/\/+$/, "") : new URL(req.url).origin;

  return `${origin}${CALLBACK_PATH}`;
}
