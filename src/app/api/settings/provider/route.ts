import { NextResponse } from "next/server";
import { clearEngine, describeConnection, setEngine } from "@/lib/settings";
import { getPlugin, getVideoProvider, getVideoProviderName } from "@/lib/providers";
import { resetMcpClients } from "@/lib/providers/higgsfield-mcp";
import type { PluginConfig } from "@/types/plugin";

export const dynamic = "force-dynamic";

/**
 * Connect a video engine from the interface.
 *
 * The configuration is stored server-side and checked against the engine
 * before we report success, so an operator finds out something is wrong here
 * rather than halfway through a batch they have already paid for.
 *
 * The response carries a `ProviderConnection` — the configuration with every
 * secret masked — never the values themselves.
 */
export async function POST(req: Request) {
  let body: { pluginId?: unknown; config?: unknown };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  }

  const pluginId = typeof body.pluginId === "string" ? body.pluginId : "";
  const plugin = getPlugin(pluginId);

  if (!plugin) {
    return NextResponse.json({ error: "Motor desconocido" }, { status: 400 });
  }

  // Only the fields this plugin declares are kept. An unknown key in the body
  // is dropped rather than stored, so the panel cannot smuggle state in.
  const incoming = (body.config ?? {}) as Record<string, unknown>;
  const config: PluginConfig = {};

  for (const field of plugin.fields) {
    const value = incoming[field.name];
    if (typeof value === "string" && value.trim()) config[field.name] = value.trim();
  }

  const missing = plugin.fields
    .filter((field) => field.required && !config[field.name])
    .map((field) => field.label);

  if (missing.length > 0 || !plugin.isConfigured(config)) {
    return NextResponse.json(
      {
        error:
          missing.length > 0
            ? `Falta ${missing.join(", ")}.`
            : "La configuración está incompleta.",
      },
      { status: 400 }
    );
  }

  try {
    // Stored first, because verification reads the configuration back out of
    // the store — the plugin has no other way to be handed one.
    setEngine({ pluginId: plugin.id, config, verified: false, at: Date.now() });
  } catch (err) {
    // The only cause is the environment owning the engine, which is a 409, not
    // a server fault: the request is valid, the state refuses it.
    const message = err instanceof Error ? err.message : "No se pudo guardar";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  // A previous MCP session was opened against the old configuration.
  resetMcpClients();

  const verification = await getVideoProvider().verifyCredentials?.();

  if (verification && !verification.ok) {
    // Rejected outright: don't leave behind a configuration we know is broken.
    clearEngine();
    return NextResponse.json({ error: verification.message }, { status: 400 });
  }

  if (verification) {
    setEngine({
      pluginId: plugin.id,
      config,
      verified: verification.verified,
      at: Date.now(),
    });
  }

  return NextResponse.json({
    connection: describeConnection(getVideoProviderName()),
    message: verification?.message ?? "Motor conectado.",
  });
}

/** Disconnect, falling back to the simulated provider. */
export async function DELETE() {
  try {
    clearEngine();
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo desconectar";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  resetMcpClients();

  return NextResponse.json({
    connection: describeConnection(getVideoProviderName()),
    message: "Desconectado. Se usará el proveedor simulado.",
  });
}
