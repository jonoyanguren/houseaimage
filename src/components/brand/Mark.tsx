/**
 * The mark: a roofline over an aperture.
 *
 * Two readings in one shape — a building and a lens — which is the whole
 * product in a glyph. Drawn as strokes at the same hairline weight as the
 * interface borders, so it belongs to the same drawing as everything else
 * instead of sitting on top of it.
 *
 * Inherits `currentColor`, so it needs no theme handling of its own.
 */
export function Mark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* Roofline and walls. */}
      <path
        d="M3.2 10.4 12 3.4l8.8 7V20a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8v-9.6Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      {/* The aperture: a lens ring with the play triangle inside it. */}
      <circle cx="12" cy="13.6" r="3.6" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M10.9 12.1 14 13.6l-3.1 1.5v-3Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Mark plus wordmark.
 *
 * Set in the interface face at a small size with open tracking, the way a
 * serial plate is engraved rather than the way a logotype is drawn — the
 * product is an instrument, and the name should read as its label.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark className="h-5 w-5 text-accent" />
      <span className="text-small font-medium uppercase leading-none tracking-[0.18em]">
        houseaimage
      </span>
    </span>
  );
}
