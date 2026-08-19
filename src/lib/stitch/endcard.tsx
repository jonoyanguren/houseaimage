import { ImageResponse } from "next/og";
import type { BrandSettings } from "@/types/settings";

/**
 * The closing card.
 *
 * Without it the video ends on a room and the viewer has no idea who to call,
 * which is the difference between a nice clip and a piece of marketing. It is
 * the cheapest thing in the whole pipeline that makes the file worth
 * publishing.
 *
 * Rendered as a PNG rather than drawn by ffmpeg on purpose: `drawtext` needs a
 * font file at a path we would have to guess per host, and it renders accents
 * badly when it finds the wrong one — on Spanish agency names that is most of
 * them. `next/og` is already a dependency, carries its own font, and lays out
 * text properly.
 */
export async function renderEndCard(
  brand: BrandSettings,
  width: number,
  height: number
): Promise<Buffer> {
  // Scaled from the frame rather than fixed, so the card reads the same on a
  // 1080x1920 vertical reel as on a 1920x1080 landscape one.
  const unit = Math.min(width, height) / 100;

  const response = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: unit * 3,
          background: "#08080a",
          padding: unit * 8,
        }}
      >
        {brand.logoUrl && brand.logoUrl.startsWith("http") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brand.logoUrl}
            alt=""
            width={unit * 26}
            style={{ objectFit: "contain", marginBottom: unit * 2 }}
          />
        ) : null}

        {brand.agencyName ? (
          <span
            style={{
              color: "#eceae7",
              fontSize: unit * 7,
              textAlign: "center",
              lineHeight: 1.15,
            }}
          >
            {brand.agencyName}
          </span>
        ) : null}

        {brand.contact ? (
          <span
            style={{
              color: "#c8a96a",
              fontSize: unit * 3.6,
              textAlign: "center",
              letterSpacing: unit * 0.12,
            }}
          >
            {brand.contact}
          </span>
        ) : null}
      </div>
    ),
    { width, height }
  );

  return Buffer.from(await response.arrayBuffer());
}

/** True when there is anything worth showing on a closing card. */
export function hasEndCardContent(brand: BrandSettings): boolean {
  return Boolean(brand.endCard && (brand.agencyName || brand.contact || brand.logoUrl));
}
