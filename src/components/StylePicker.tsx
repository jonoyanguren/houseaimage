"use client";

import type { PropertyType, StyleId } from "@/types/video";
import { stylesForProperty } from "@/lib/prompts";
import { StylePreview } from "@/components/StylePreview";

/**
 * Style chooser.
 *
 * Each card carries what the style is for and the format it produces, because
 * the format is the consequential part of the choice: picking "dinámico" also
 * picks 9:16, which is right for a Reel and wrong for a portal listing. Hiding
 * that until after the render wastes the user's credits.
 *
 * Ordering follows the property type — a drone reel leads for a country
 * property and sinks for a one-bedroom flat — but nothing is ever removed.
 */
export function StylePicker({
  value,
  propertyType,
  onChange,
  disabled,
}: {
  value: StyleId;
  propertyType: PropertyType;
  onChange: (styleId: StyleId) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 disabled:opacity-40">
      <legend className="sr-only">Estilo del vídeo</legend>

      <div className="grid gap-3 sm:grid-cols-2">
        {stylesForProperty(propertyType).map(({ style, recommended }) => {
          const selected = style.id === value;

          return (
            <label
              key={style.id}
              className={`group relative flex cursor-pointer flex-col gap-2 rounded-sm border p-4 transition-colors duration-300 ${
                selected
                  ? "border-accent-line bg-accent-soft"
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

              <div className="flex gap-4">
                <StylePreview
                  styleId={style.id}
                  aspectRatio={style.aspectRatio}
                  active={selected}
                />

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-baseline gap-2">
                      <span className="headline text-lead leading-none">
                        {style.label}
                      </span>
                      {recommended && (
                        <span className="text-micro uppercase tracking-[0.2em] text-accent">
                          Recomendado
                        </span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 numeric text-micro ${
                        selected ? "text-accent" : "text-faint"
                      }`}
                    >
                      {style.aspectRatio} · {style.durationSeconds}s
                    </span>
                  </div>

                  <p className="text-small leading-relaxed text-muted">
                    {style.tagline}
                  </p>

                  <p className="text-label leading-relaxed text-faint">
                    {style.bestFor.join(" · ")}
                  </p>
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
