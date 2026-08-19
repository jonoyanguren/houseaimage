import { NextResponse } from "next/server";
import { beginAuthorization } from "@/lib/mcp/connection";
import { getEngineSelection } from "@/lib/settings";
import { callbackUrl } from "@/lib/mcp/redirect";

export const dynamic = "force-dynamic";

/**
 * Start the OAuth handshake with the configured MCP server.
 *
 * Deliberately under `/api/settings` rather than `/api/auth`: the access gate
 * lets `/api/auth` through so people can log in, and an ungated authorisation
 * endpoint would let a stranger point the platform's rendering at their own
 * account. This route changes which account pays, so it belongs behind the
 * same door as the rest of the settings.
 */
export async function GET(req: Request) {
  const { pluginId, config } = getEngineSelection();

  if (pluginId !== "higgsfield-mcp" || !config.url) {
    return NextResponse.json(
      { error: "Guarda primero la URL del servidor MCP en Ajustes." },
      { status: 400 }
    );
  }

  try {
    const url = await beginAuthorization({
      resource: config.url,
      redirectUri: callbackUrl(req),
    });

    // A redirect rather than a JSON payload: the browser has to make this
    // journey itself, and it is the browser that will come back with the code.
    return NextResponse.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
