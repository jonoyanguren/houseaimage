import {
  authorizationUrl,
  createPkce,
  discover,
  exchangeCode,
  randomState,
  refresh,
  register,
  type AuthorizationServer,
  type OAuthTokens,
} from "@/lib/mcp/oauth";

/**
 * The state behind "Conectar con Higgsfield".
 *
 * Holds three things per MCP endpoint: what its authorisation server looks
 * like, the client id we registered, and the tokens we were given. Everything
 * is discovered once and reused, so authorising is a browser round trip the
 * first time and nothing at all afterwards.
 *
 * ⚠️ In memory and per process, like `jobStore`, `lock` and `settings`. A
 * restart means authorising again. Surviving one means encrypting a refresh
 * token at rest against a real secret store, and that decision belongs with
 * the one to add a database — see the production notes in the README.
 */

interface Connection {
  server: AuthorizationServer;
  clientId: string;
  redirectUri: string;
  tokens?: OAuthTokens;
}

interface Pending {
  verifier: string;
  resource: string;
  redirectUri: string;
  expiresAt: number;
}

const globalForOAuth = globalThis as unknown as {
  __houseaimageOAuth?: {
    connections: Map<string, Connection>;
    pending: Map<string, Pending>;
  };
};

const store = (globalForOAuth.__houseaimageOAuth ??= {
  connections: new Map<string, Connection>(),
  pending: new Map<string, Pending>(),
});

/** Long enough to log in and think about it, short enough not to linger. */
const PENDING_TTL_MS = 10 * 60_000;

/**
 * Discovery and registration, done once per endpoint.
 *
 * Cached together because they are useless apart: a client id is only valid
 * against the server that issued it, and both are cheap to keep.
 */
async function prepare(resource: string, redirectUri: string): Promise<Connection> {
  const existing = store.connections.get(resource);

  // A changed redirect means a different deployment address, and the old
  // registration does not cover it.
  if (existing && existing.redirectUri === redirectUri) return existing;

  const server = await discover(resource);

  if (!server.registrationEndpoint) {
    throw new Error(
      "Este servidor MCP no permite registro dinámico de clientes, así que hace " +
        "falta un client_id dado de alta a mano."
    );
  }

  const clientId = await register(server.registrationEndpoint, redirectUri);
  const connection: Connection = {
    server,
    clientId,
    redirectUri,
    // Kept across a re-registration: the tokens are still valid.
    tokens: existing?.tokens,
  };

  store.connections.set(resource, connection);
  return connection;
}

/** Drop expired authorisations rather than letting the map grow forever. */
function sweep(now: number) {
  for (const [state, entry] of store.pending) {
    if (now >= entry.expiresAt) store.pending.delete(state);
  }
}

/**
 * Start the flow: returns the URL to send the operator's browser to.
 *
 * The verifier never leaves this process — only its hash travels — which is
 * the whole point of PKCE for a client that has no secret.
 */
export async function beginAuthorization(input: {
  resource: string;
  redirectUri: string;
  now?: number;
}): Promise<string> {
  const now = input.now ?? Date.now();
  sweep(now);

  const connection = await prepare(input.resource, input.redirectUri);
  const { verifier, challenge } = await createPkce();
  const state = randomState();

  store.pending.set(state, {
    verifier,
    resource: input.resource,
    redirectUri: input.redirectUri,
    expiresAt: now + PENDING_TTL_MS,
  });

  return authorizationUrl({
    server: connection.server,
    clientId: connection.clientId,
    redirectUri: input.redirectUri,
    state,
    challenge,
    resource: input.resource,
  });
}

/**
 * Finish the flow.
 *
 * The `state` is consumed on arrival, so a replayed callback cannot mint a
 * second token — and an unknown one is rejected rather than trusted, which is
 * what makes this resistant to a forged redirect.
 */
export async function completeAuthorization(input: {
  state: string;
  code: string;
  now?: number;
}): Promise<string> {
  const now = input.now ?? Date.now();
  const pending = store.pending.get(input.state);
  store.pending.delete(input.state);

  if (!pending || now >= pending.expiresAt) {
    throw new Error("La autorización caducó o no se reconoce. Vuelve a empezar.");
  }

  const connection = store.connections.get(pending.resource);
  if (!connection) throw new Error("No hay ninguna conexión a medio abrir.");

  const tokens = await exchangeCode({
    server: connection.server,
    clientId: connection.clientId,
    redirectUri: pending.redirectUri,
    code: input.code,
    verifier: pending.verifier,
    resource: pending.resource,
    now,
  });

  store.connections.set(pending.resource, { ...connection, tokens });
  return pending.resource;
}

/**
 * A usable access token, renewed if it is about to expire.
 *
 * Returns undefined rather than throwing when there is nothing to offer: the
 * caller's job is to report "not connected", not to handle an exception.
 */
export async function getAccessToken(
  resource: string,
  now = Date.now()
): Promise<string | undefined> {
  const connection = store.connections.get(resource);
  const tokens = connection?.tokens;
  if (!connection || !tokens) return undefined;

  const fresh = !tokens.expiresAt || tokens.expiresAt > now;
  if (fresh) return tokens.accessToken;

  return renew(resource, now);
}

/**
 * Force a renewal, whatever the clock says.
 *
 * Used when the server rejects a token we believed was fine — clocks drift and
 * sessions get revoked, and one refresh is cheaper than telling the operator
 * to authorise again.
 */
export async function renew(
  resource: string,
  now = Date.now()
): Promise<string | undefined> {
  const connection = store.connections.get(resource);
  if (!connection?.tokens?.refreshToken) return undefined;

  try {
    const tokens = await refresh({
      server: connection.server,
      clientId: connection.clientId,
      refreshToken: connection.tokens.refreshToken,
      resource,
      now,
    });

    store.connections.set(resource, { ...connection, tokens });
    return tokens.accessToken;
  } catch {
    // The refresh token is spent or revoked. Drop it so the interface says
    // "connect" instead of failing every clip with the same error.
    store.connections.set(resource, { ...connection, tokens: undefined });
    return undefined;
  }
}

export function isConnected(resource: string): boolean {
  return Boolean(store.connections.get(resource)?.tokens);
}

export function disconnect(resource: string): void {
  const connection = store.connections.get(resource);
  if (connection) store.connections.set(resource, { ...connection, tokens: undefined });
}

/** Test seam: forget everything, registrations included. */
export function __resetOAuth() {
  store.connections.clear();
  store.pending.clear();
}
