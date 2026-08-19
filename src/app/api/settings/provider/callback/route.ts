import { NextResponse } from "next/server";
import { completeAuthorization } from "@/lib/mcp/connection";

export const dynamic = "force-dynamic";

/**
 * Where the authorisation server sends the operator back.
 *
 * Always ends in a redirect to the workspace, with the outcome in the query
 * string: this route is reached by a browser, not by a script, and a JSON body
 * would leave someone staring at a payload.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const home = new URL("/", req.url);

  // The server reports a refusal here rather than by failing the exchange.
  const denied = params.get("error");
  if (denied) {
    home.searchParams.set("motor", "error");
    home.searchParams.set("detalle", params.get("error_description") ?? denied);
    return NextResponse.redirect(home);
  }

  const code = params.get("code");
  const state = params.get("state");

  if (!code || !state) {
    home.searchParams.set("motor", "error");
    home.searchParams.set("detalle", "La respuesta no traía código ni estado.");
    return NextResponse.redirect(home);
  }

  try {
    await completeAuthorization({ code, state });
    home.searchParams.set("motor", "conectado");
  } catch (err) {
    home.searchParams.set("motor", "error");
    home.searchParams.set(
      "detalle",
      err instanceof Error ? err.message : "No se pudo completar la autorización."
    );
  }

  return NextResponse.redirect(home);
}
