"use client";

import type { StyleId } from "@/types/video";

/**
 * A moving diagram of what a style does to the camera.
 *
 * The style cards described the movement in words — "lento, elegante, con
 * peso" — which asks the buyer to imagine the thing they are about to pay to
 * find out. This shows it: a schematic room inside a frame of the style's real
 * aspect ratio, moving the way that style moves.
 *
 * It is deliberately a **diagram**, not footage. Hairlines and no photography,
 * so nobody can mistake it for a sample render — the honest version of a
 * preview when the product has not generated anything yet.
 */

/** Keyframe and pacing per style. Values match the character, not the clock. */
const MOTION: Record<StyleId, { animation: string }> = {
  cinematografico: { animation: "camera-push 6s ease-in-out infinite alternate" },
  dron: { animation: "camera-orbit 7s ease-in-out infinite alternate" },
  dinamico: { animation: "camera-snap 2.6s ease-in-out infinite alternate" },
  tour: { animation: "camera-pan 5s ease-in-out infinite alternate" },
  editorial: { animation: "camera-hold 8s ease-in-out infinite alternate" },
  lifestyle: { animation: "camera-tilt 5.5s ease-in-out infinite alternate" },
};

/** Tailwind cannot build an arbitrary ratio from a runtime string. */
const ASPECT: Record<string, string> = {
  "16:9": "16 / 9",
  "9:16": "9 / 16",
  "4:5": "4 / 5",
  "1:1": "1 / 1",
};

export function StylePreview({
  styleId,
  aspectRatio,
  active,
}: {
  styleId: StyleId;
  aspectRatio: string;
  /** Only the selected card moves; six looping cards at once is a fairground. */
  active: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className="relative shrink-0 overflow-hidden rounded-sm border border-line bg-canvas"
      style={{ aspectRatio: ASPECT[aspectRatio] ?? "16 / 9", width: 64 }}
    >
      <div
        className="h-full w-full"
        style={active ? { animation: MOTION[styleId].animation } : undefined}
      >
        <svg
          viewBox="0 0 64 36"
          preserveAspectRatio="xMidYMid slice"
          className="h-full w-full"
        >
          {/* Floor and back wall: enough perspective to read as a room. */}
          <path
            d="M0 26h64M14 26 22 14h20l8 12"
            stroke="currentColor"
            strokeOpacity="0.22"
            strokeWidth="0.7"
            fill="none"
          />
          {/* The window is the accent: it is what a property video sells. */}
          <rect
            x="27"
            y="17"
            width="10"
            height="7"
            className="fill-accent"
            fillOpacity="0.32"
          />
          <path
            d="M6 26V19M58 26V19"
            stroke="currentColor"
            strokeOpacity="0.14"
            strokeWidth="0.7"
          />
        </svg>
      </div>
    </div>
  );
}
