import { NextResponse } from "next/server";
import { getVideoProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

/**
 * The models the connected engine can render with, and what the account has
 * left to spend on them.
 *
 * Fetched from the backend rather than written down here: catalogues move —
 * models get added, renamed and retired — and a hard-coded list becomes a lie
 * on a schedule. The simulated provider offers none, which is honest: it does
 * not render, so it has nothing to choose between.
 */
export async function GET() {
  const provider = getVideoProvider();

  if (!provider.listModels) {
    return NextResponse.json({ models: [], balance: undefined });
  }

  try {
    // In parallel: neither depends on the other, and both are one round trip
    // to the same server.
    const [models, balance] = await Promise.all([
      provider.listModels(),
      provider.getBalance?.() ?? Promise.resolve(undefined),
    ]);

    return NextResponse.json({ models, balance });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message, models: [] }, { status: 502 });
  }
}
