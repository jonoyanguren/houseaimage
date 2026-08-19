/**
 * OAuth for an MCP server that wants it.
 *
 * Higgsfield's MCP endpoint answers an unauthenticated call with
 *
 *   401  www-authenticate: Bearer resource_metadata="…", scope="openid email offline_access"
 *
 * so there is no key to paste: the operator has to authorise once, in a
 * browser. Everything here exists to make that "once" actually mean once.
 *
 * Three things in its metadata make this workable for a server product rather
 * than merely possible:
 *
 * - **Dynamic client registration.** The app registers itself. Nobody has to
 *   go and provision a client id by hand.
 * - **PKCE.** A public client with no secret to keep, which is exactly what a
 *   self-hosted app should be.
 * - **`offline_access`.** A refresh token, so the server keeps working at
 *   three in the morning with nobody logged in anywhere.
 *
 * Written against the specs rather than against Higgsfield: discovery,
 * registration and the code exchange are all standard, so another
 * OAuth-protected MCP server should work with the same code.
 */

/** What the resource tells us about who guards it. */
interface ResourceMetadata {
  authorization_servers?: string[];
  scopes_supported?: string[];
}

/** What the authorisation server tells us about its own endpoints. */
interface ServerMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

export interface AuthorizationServer {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scope: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch millis. Undefined when the server did not say. */
  expiresAt?: number;
}

const DISCOVERY_TIMEOUT_MS = 15_000;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Find the endpoints, starting from the MCP URL alone.
 *
 * Tries the resource-scoped metadata path first — the one the `401` names —
 * then the bare one, then the authorisation server's own document. Each step
 * is allowed to fail, because servers implement different halves of these
 * specs and the next path usually answers.
 */
export async function discover(mcpUrl: string): Promise<AuthorizationServer> {
  const url = new URL(mcpUrl);
  const origin = url.origin;
  // `/mcp` → `/.well-known/oauth-protected-resource/mcp`, as the header says.
  const suffix = url.pathname.replace(/^\/+/, "");

  const resource =
    (await getJson<ResourceMetadata>(
      `${origin}/.well-known/oauth-protected-resource/${suffix}`
    )) ??
    (await getJson<ResourceMetadata>(`${origin}/.well-known/oauth-protected-resource`));

  // The first listed server is the one meant for clients that can receive a
  // redirect, which a web application can.
  const issuer = resource?.authorization_servers?.[0] ?? origin;

  const server =
    (await getJson<ServerMetadata>(`${issuer}/.well-known/oauth-authorization-server`)) ??
    (await getJson<ServerMetadata>(`${issuer}/.well-known/openid-configuration`));

  if (!server?.authorization_endpoint || !server.token_endpoint) {
    throw new Error(
      `El servidor MCP ${origin} pide OAuth pero no publica sus endpoints de autorización.`
    );
  }

  const scopes = resource?.scopes_supported ?? server.scopes_supported ?? [];

  return {
    authorizationEndpoint: server.authorization_endpoint,
    tokenEndpoint: server.token_endpoint,
    registrationEndpoint: server.registration_endpoint,
    // `offline_access` is the one that matters: without it there is no refresh
    // token, and the connection dies the first time the access token expires.
    scope: scopes.length > 0 ? scopes.join(" ") : "openid email offline_access",
  };
}

/**
 * Register this installation as an OAuth client.
 *
 * Public client, no secret: the app runs on someone else's server and a secret
 * shipped in a repository is not a secret. PKCE is what protects the exchange.
 */
export async function register(
  registrationEndpoint: string,
  redirectUri: string
): Promise<string> {
  const res = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "houseaimage",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`No se pudo registrar el cliente (${res.status}): ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as { client_id?: string };
  if (!data.client_id) throw new Error("El registro no devolvió client_id");

  return data.client_id;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** A PKCE pair. The verifier stays here; only its hash goes to the browser. */
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );

  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function randomState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(24)));
}

export function authorizationUrl(input: {
  server: AuthorizationServer;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  /** Named so the token is issued for this MCP endpoint and not some other. */
  resource: string;
}): string {
  const url = new URL(input.server.authorizationEndpoint);

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.server.scope);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", input.resource);

  return url.toString();
}

function readTokens(data: Record<string, unknown>, now: number): OAuthTokens {
  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  if (!accessToken) throw new Error("La respuesta no traía access_token");

  return {
    accessToken,
    refreshToken:
      typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    expiresAt:
      typeof data.expires_in === "number"
        ? // Sixty seconds of margin, so a token never expires in flight.
          now + Math.max(0, data.expires_in - 60) * 1000
        : undefined,
  };
}

/** Swap the authorisation code for tokens. */
export async function exchangeCode(input: {
  server: AuthorizationServer;
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
  resource: string;
  now?: number;
}): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.verifier,
    resource: input.resource,
  });

  const res = await fetch(input.server.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`El canje del código falló (${res.status}): ${detail.slice(0, 200)}`);
  }

  return readTokens(await res.json(), input.now ?? Date.now());
}

/**
 * Trade a refresh token for a fresh access token.
 *
 * Servers may or may not rotate the refresh token; when they do not, the old
 * one is carried forward so the connection survives either behaviour.
 */
export async function refresh(input: {
  server: AuthorizationServer;
  clientId: string;
  refreshToken: string;
  resource: string;
  now?: number;
}): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    resource: input.resource,
  });

  const res = await fetch(input.server.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`No se pudo renovar el acceso (${res.status}): ${detail.slice(0, 200)}`);
  }

  const tokens = readTokens(await res.json(), input.now ?? Date.now());
  return { ...tokens, refreshToken: tokens.refreshToken ?? input.refreshToken };
}
