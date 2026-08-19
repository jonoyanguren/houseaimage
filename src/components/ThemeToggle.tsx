"use client";

/**
 * Dark / light, as a deliberate choice.
 *
 * The app used to follow `prefers-color-scheme`, which meant anyone whose
 * machine was set to light got an ivory interface they never asked for — the
 * weakest version of this design, handed out by default. Dark is the product
 * now, and light is opt-in from here.
 *
 * Deliberately stateless. The current theme lives in one place, the `data-theme`
 * attribute, and this reads it at click time rather than mirroring it into
 * React. Mirroring would mean either an effect that syncs after paint — which
 * the lint rules rightly refuse — or a lazy initialiser that disagrees with the
 * server and trips hydration. The glyph is the same in both states, so there is
 * nothing to re-render anyway.
 *
 * The saved value is applied by an inline script in the layout, before paint,
 * so there is no flash to prevent here either.
 */
const STORAGE_KEY = "hai-theme";

export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "light" ? "dark" : "light";

    // Dark is the default and carries no attribute, so switching to it removes
    // the opt-in rather than writing an opposite one.
    if (next === "light") root.dataset.theme = "light";
    else delete root.dataset.theme;

    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Private mode: the choice simply does not survive the session. */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Cambiar entre tema oscuro y claro"
      title="Cambiar entre tema oscuro y claro"
      className="flex h-7 w-7 items-center justify-center rounded-sm text-muted transition-colors duration-300 hover:bg-surface hover:text-ink"
    >
      {/* A half-filled disc: one glyph that reads as both states at once. */}
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 2a6 6 0 0 1 0 12Z" fill="currentColor" />
      </svg>
    </button>
  );
}
