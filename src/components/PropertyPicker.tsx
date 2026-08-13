"use client";

import type { PropertyType } from "@/types/video";
import { PROPERTY_LIST } from "@/lib/prompts";

/**
 * Property type chooser.
 *
 * It comes first in the flow because it conditions everything after it: which
 * styles are worth offering, which scenes get surfaced, and how each photo is
 * pre-classified. Asking it last would mean re-deciding all three.
 */
export function PropertyPicker({
  value,
  onChange,
  disabled,
}: {
  value: PropertyType;
  onChange: (propertyType: PropertyType) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 disabled:opacity-40">
      <legend className="sr-only">Tipo de inmueble</legend>

      <div className="flex flex-wrap gap-2">
        {PROPERTY_LIST.map((property) => {
          const selected = property.id === value;

          return (
            <label
              key={property.id}
              title={property.hint}
              className={`cursor-pointer rounded-full border px-4 py-2 text-[13px] transition-colors duration-300 ${
                selected
                  ? "border-accent bg-accent-soft text-ink"
                  : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              <input
                type="radio"
                name="propertyType"
                value={property.id}
                checked={selected}
                onChange={() => onChange(property.id)}
                className="sr-only"
              />
              {property.label}
            </label>
          );
        })}
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-faint">
        {PROPERTY_LIST.find((p) => p.id === value)?.hint}
      </p>
    </fieldset>
  );
}
