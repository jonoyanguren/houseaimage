import { ImageResponse } from "next/og";

/**
 * The home-screen icon.
 *
 * Generated rather than shipped as a file because the `apple-icon` convention
 * only accepts raster formats, and the mark is drawn as strokes — exporting a
 * PNG by hand would leave two copies of the same drawing to keep in step.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#08080a",
        }}
      >
        <svg width="118" height="118" viewBox="0 0 24 24" fill="none">
          <path
            d="M3.2 10.4 12 3.4l8.8 7V20a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8v-9.6Z"
            stroke="#c8a96a"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="13.6" r="3.6" stroke="#c8a96a" strokeWidth="1.1" />
          <path d="M10.9 12.1 14 13.6l-3.1 1.5v-3Z" fill="#c8a96a" />
        </svg>
      </div>
    ),
    size
  );
}
