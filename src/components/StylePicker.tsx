"use client";

import type { StyleId } from "@/types/video";
import { STYLE_LIST } from "@/lib/prompts";

/**
 * Style chooser.
 *
 * Each card carries what the style is for and the format it produces, because
 * the format is the consequential part of the choice: picking "dinámico" also
 * picks 9:16, which is right for a Reel and wrong for a portal listing. Hiding
 * that until after the render wastes the user's credits.
 */
export function StylePicker({
  value,
  onChange,
  disabled,
}: {
  value: StyleId;
  onChange: (styleId: StyleId) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 disabled:opacity-40">
      <legend className="sr-only">Estilo del vídeo</legend>

      <div className="grid gap-3 sm:grid-cols-2">
        {STYLE_LIST.map((style) => {
          const selected = style.id === value;

          return (
            <label
              key={style.id}
              className={`group relative flex cursor-pointer flex-col gap-2 rounded-sm border p-5 transition-colors duration-300 ${
                selected
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-surface hover:border-line-strong"
              }`}
            >
              <input
                type="radio"
                name="style"
                value={style.id}
                checked={selected}
                onChange={() => onChange(style.id)}
                className="sr-only"
              />

              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display text-lg leading-none tracking-tight">
                  {style.label}
                </span>
                <span
                  className={`font-mono text-[10px] tracking-widest ${
                    selected ? "text-accent" : "text-faint"
                  }`}
                >
                  {style.aspectRatio} · {style.durationSeconds}s
                </span>
              </div>

              <p className="text-[13px] leading-relaxed text-muted">
                {style.tagline}
              </p>

              <p className="text-[12px] leading-relaxed text-faint">
                {style.bestFor.join(" · ")}
              </p>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
