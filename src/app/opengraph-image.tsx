import { ImageResponse } from "next/og";

/**
 * The card that appears when the link is pasted into WhatsApp, Slack or a
 * portal — for a product sold to agencies, that preview is often the first
 * thing anyone sees of it.
 *
 * Drawn with the same tokens as the app, but literal here: this renders
 * outside the document, so there are no CSS variables to inherit. It uses no
 * downloaded font on purpose, so a build never depends on reaching Google.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "houseaimage · Estudio de vídeo inmobiliario";

const CANVAS = "#000000";
const INK = "#f2f0ed";
const ACCENT = "#c8a96a";
const MUTED = "#a09c94";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: CANVAS,
          padding: 72,
          border: `1px solid ${ACCENT}33`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
            <path
              d="M3.2 10.4 12 3.4l8.8 7V20a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8v-9.6Z"
              stroke={ACCENT}
              strokeWidth="1.1"
            />
            <circle cx="12" cy="13.6" r="3.6" stroke={ACCENT} strokeWidth="1.1" />
            <path d="M10.9 12.1 14 13.6l-3.1 1.5v-3Z" fill={ACCENT} />
          </svg>
          <span style={{ color: INK, fontSize: 34, letterSpacing: -0.5 }}>
            houseaimage
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <span style={{ color: INK, fontSize: 76, lineHeight: 1.05, maxWidth: 900 }}>
            De las fotos del anuncio al vídeo del inmueble
          </span>
          <span style={{ color: MUTED, fontSize: 28, maxWidth: 760 }}>
            Cada fotografía se convierte en un plano con movimiento de cámara.
          </span>
        </div>

        <div style={{ display: "flex", gap: 28, color: ACCENT, fontSize: 20 }}>
          <span>ESTUDIO DE VÍDEO INMOBILIARIO</span>
        </div>
      </div>
    ),
    size
  );
}
