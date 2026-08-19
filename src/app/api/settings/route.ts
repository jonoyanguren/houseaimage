import { NextResponse } from "next/server";
import { setBrand, toPublicSettings } from "@/lib/settings";
import { getVideoProviderName } from "@/lib/providers";
import type { BrandSettings } from "@/types/settings";

/** Reflects mutable server state, so it must never be cached. */
export const dynamic = "force-dynamic";

/**
 * Settings as the browser may see them.
 *
 * Note what is absent: the API key. `toPublicSettings` returns a description
 * of the connection — provider, source, last four characters — and never the
 * secret itself. A key that reaches the browser is a key in every extension's
 * reach, and there is no reason for it to go there.
 */
export async function GET() {
  return NextResponse.json(await toPublicSettings(getVideoProviderName()));
}

/** Update the agency identity stamped onto the delivered video. */
export async function PATCH(req: Request) {
  let patch: Partial<BrandSettings>;

  try {
    patch = (await req.json()) as Partial<BrandSettings>;
  } catch {
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  }

  // Only the fields we own — an unknown key in the body is ignored, not stored.
  const brand = setBrand({
    agencyName: typeof patch.agencyName === "string" ? patch.agencyName.slice(0, 80) : undefined,
    contact: typeof patch.contact === "string" ? patch.contact.slice(0, 120) : undefined,
    endCard: typeof patch.endCard === "boolean" ? patch.endCard : undefined,
    watermark: typeof patch.watermark === "boolean" ? patch.watermark : undefined,
    logoUrl: typeof patch.logoUrl === "string" ? patch.logoUrl : undefined,
  });

  return NextResponse.json({ brand });
}
