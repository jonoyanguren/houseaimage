import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  __resetOAuth,
  beginAuthorization,
  completeAuthorization,
  disconnect,
  getAccessToken,
  isConnected,
  renew,
} from "@/lib/mcp/connection";
import { createPkce, discover } from "@/lib/mcp/oauth";

/**
 * The OAuth handshake, against an authorisation server we control.
 *
 * Worth testing properly because none of it can be checked by reading: a
 * redirect goes out, a browser comes back, and the only evidence a mistake
 * leaves is a 401 halfway through someone's batch. So this drives the whole
 * journey — discovery, registration, authorise, exchange, refresh — and then
 * attacks it: replayed state, expired state, spent refresh token.
 */

const calls: { path: string; body: string }[] = [];

/** Registrations the fake server has issued, so a test can count them. */
let registrations = 0;
/** What the token endpoint answers with. */
let tokenResponse: Record<string, unknown> = {
  access_token: "acceso-1",
  refresh_token: "refresco-1",
  expires_in: 3600,
};
let tokenStatus = 200;
/** Omit the registration endpoint, as a stricter server might. */
let offerRegistration = true;

let server: Server | undefined;
let issuer = "";
let resource = "";

const REDIRECT = "http://localhost:3000/api/settings/provider/callback";

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));

    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      calls.push({ path, body });

      const json = (payload: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (path === "/.well-known/oauth-protected-resource/mcp") {
        json({
          resource: `${issuer}/mcp`,
          authorization_servers: [issuer],
          scopes_supported: ["openid", "email", "offline_access"],
        });
        return;
      }

      if (path === "/.well-known/oauth-authorization-server") {
        json({
          issuer,
          authorization_endpoint: `${issuer}/oauth2/authorize`,
          token_endpoint: `${issuer}/oauth2/token`,
          ...(offerRegistration
            ? { registration_endpoint: `${issuer}/oauth2/register` }
            : {}),
        });
        return;
      }

      if (path === "/oauth2/register") {
        registrations++;
        json({ client_id: `cliente-${registrations}` });
        return;
      }

      if (path === "/oauth2/token") {
        if (tokenStatus !== 200) {
          res.writeHead(tokenStatus).end(JSON.stringify({ error: "invalid_grant" }));
          return;
        }
        json(tokenResponse);
        return;
      }

      res.writeHead(404).end();
    });
  });

  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server.address();
  issuer = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  resource = `${issuer}/mcp`;
});

afterAll(() => server?.close());

beforeEach(() => {
  calls.length = 0;
  registrations = 0;
  tokenStatus = 200;
  offerRegistration = true;
  tokenResponse = {
    access_token: "acceso-1",
    refresh_token: "refresco-1",
    expires_in: 3600,
  };
  __resetOAuth();
});

/** Walk the flow to the point where tokens are held. */
async function connect(now = 1_000_000): Promise<void> {
  const url = await beginAuthorization({ resource, redirectUri: REDIRECT, now });
  const state = new URL(url).searchParams.get("state")!;
  await completeAuthorization({ state, code: "codigo-1", now });
}

describe("pkce", () => {
  it("sends a hash, never the verifier", async () => {
    const { verifier, challenge } = await createPkce();

    // The challenge is the S256 of the verifier, so what travels through the
    // browser cannot be replayed at the token endpoint.
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier)
    );
    expect(challenge).toBe(Buffer.from(new Uint8Array(digest)).toString("base64url"));
    expect(challenge).not.toBe(verifier);
  });
});

describe("discovery", () => {
  it("finds the endpoints from the MCP url alone", async () => {
    const found = await discover(resource);

    expect(found.authorizationEndpoint).toBe(`${issuer}/oauth2/authorize`);
    expect(found.tokenEndpoint).toBe(`${issuer}/oauth2/token`);
    expect(found.scope).toContain("offline_access");
  });

  it("says so plainly when a server cannot be registered with", async () => {
    offerRegistration = false;

    await expect(
      beginAuthorization({ resource, redirectUri: REDIRECT })
    ).rejects.toThrow(/registro dinámico/);
  });
});

describe("authorization url", () => {
  it("carries everything the exchange will be checked against", async () => {
    const url = new URL(await beginAuthorization({ resource, redirectUri: REDIRECT }));

    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource")).toBe(resource);
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("registers once and reuses the client id", async () => {
    await beginAuthorization({ resource, redirectUri: REDIRECT });
    await beginAuthorization({ resource, redirectUri: REDIRECT });

    expect(registrations).toBe(1);
  });

  it("registers again when the app moves to another address", async () => {
    // A registration is only valid for the redirect it was made with, so a
    // deployment behind a new URL needs a new one.
    await beginAuthorization({ resource, redirectUri: REDIRECT });
    await beginAuthorization({ resource, redirectUri: "https://otra.test/cb" });

    expect(registrations).toBe(2);
  });
});

describe("completing the flow", () => {
  it("exchanges the code and holds the tokens", async () => {
    await connect();

    expect(isConnected(resource)).toBe(true);
    expect(await getAccessToken(resource, 1_000_000)).toBe("acceso-1");
  });

  it("sends the verifier and the redirect the code was issued for", async () => {
    await connect();

    const exchange = calls.find((c) => c.path === "/oauth2/token")!;
    const body = new URLSearchParams(exchange.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBeTruthy();
    expect(body.get("redirect_uri")).toBe(REDIRECT);
  });

  it("refuses a state it does not recognise", async () => {
    await expect(
      completeAuthorization({ state: "inventado", code: "x" })
    ).rejects.toThrow(/caducó o no se reconoce/);
  });

  it("refuses the same state twice", async () => {
    // A replayed callback must not be able to mint a second token.
    const url = await beginAuthorization({ resource, redirectUri: REDIRECT });
    const state = new URL(url).searchParams.get("state")!;

    await completeAuthorization({ state, code: "codigo-1" });
    await expect(completeAuthorization({ state, code: "codigo-1" })).rejects.toThrow();
  });

  it("refuses a state that sat around too long", async () => {
    const url = await beginAuthorization({
      resource,
      redirectUri: REDIRECT,
      now: 0,
    });
    const state = new URL(url).searchParams.get("state")!;

    await expect(
      completeAuthorization({ state, code: "codigo-1", now: 60 * 60_000 })
    ).rejects.toThrow();
  });
});

describe("keeping the connection alive", () => {
  it("renews an expired access token without anyone asking", async () => {
    await connect(1_000_000);
    tokenResponse = { access_token: "acceso-2", expires_in: 3600 };

    // An hour later the first token is past its expiry.
    expect(await getAccessToken(resource, 1_000_000 + 5_000_000)).toBe("acceso-2");
  });

  it("keeps a refresh token the server did not rotate", async () => {
    await connect(1_000_000);
    // The renewal answers without a new refresh token, as many servers do.
    tokenResponse = { access_token: "acceso-2", expires_in: 3600 };
    await renew(resource, 1_000_000 + 5_000_000);

    tokenResponse = { access_token: "acceso-3", expires_in: 3600 };
    // Only possible if the original refresh token survived the first renewal.
    expect(await renew(resource, 1_000_000 + 9_000_000)).toBe("acceso-3");
  });

  it("does not renew a token that is still good", async () => {
    await connect(1_000_000);
    calls.length = 0;

    expect(await getAccessToken(resource, 1_000_000 + 60_000)).toBe("acceso-1");
    expect(calls.some((c) => c.path === "/oauth2/token")).toBe(false);
  });

  it("forgets the session when the refresh token is spent", async () => {
    await connect(1_000_000);
    tokenStatus = 400;

    expect(await renew(resource, 1_000_000 + 5_000_000)).toBeUndefined();
    // So the interface says "authorise" instead of failing every clip with the
    // same error for the rest of the day.
    expect(isConnected(resource)).toBe(false);
  });

  it("offers nothing at all when never connected", async () => {
    expect(await getAccessToken(resource)).toBeUndefined();
    expect(isConnected(resource)).toBe(false);
  });

  it("drops the tokens on disconnect", async () => {
    await connect();
    disconnect(resource);

    expect(isConnected(resource)).toBe(false);
  });
});
