"use client";

import type { Clip, ClipStatus } from "@/types/video";

const STATUS_LABEL: Record<ClipStatus, string> = {
  queued: "En cola",
  processing: "Generando",
  completed: "Listo",
  failed: "Error",
};

const STATUS_STYLE: Record<ClipStatus, string> = {
  queued: "bg-zinc-500/80",
  processing: "bg-blue-600/85",
  completed: "bg-emerald-600/85",
  failed: "bg-red-600/85",
};

/**
 * Per-clip progress. Each photo is an independent provider job, so the user
 * sees which of them are done instead of one spinner for the whole listing.
 */
export function ClipProgressList({ clips }: { clips: Clip[] }) {
  if (clips.length === 0) return null;

  const done = clips.filter((c) => c.status === "completed").length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground/60">
        {done} de {clips.length} clips listos
      </p>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {[...clips]
          .sort((a, b) => a.index - b.index)
          .map((clip) => (
            <li
              key={clip.clipId}
              className="relative aspect-square overflow-hidden rounded-lg border border-foreground/10"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={clip.imageUrl}
                alt={`Clip ${clip.index + 1}`}
                className={`h-full w-full object-cover transition-opacity ${
                  clip.status === "completed" ? "opacity-100" : "opacity-50"
                }`}
              />

              <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {clip.index + 1}
              </span>

              <span
                className={`absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${
                  STATUS_STYLE[clip.status]
                }`}
              >
                {STATUS_LABEL[clip.status]}
              </span>

              {clip.status === "processing" && (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
                  <div
                    className="h-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${clip.progress ?? 0}%` }}
                  />
                </div>
              )}

              {clip.status === "failed" && clip.error && (
                <p
                  title={clip.error}
                  className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1.5 py-1 text-[10px] text-red-200"
                >
                  {clip.error}
                </p>
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}
