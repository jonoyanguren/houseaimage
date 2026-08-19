"use client";

import type { ClipStatus, PublicClip } from "@/types/video";

const STATUS_LABEL: Record<ClipStatus, string> = {
  queued: "En cola",
  processing: "Generando",
  completed: "Listo",
  failed: "Error",
};

const STATUS_TONE: Record<ClipStatus, string> = {
  queued: "text-faint",
  processing: "text-accent",
  completed: "text-positive",
  failed: "text-negative",
};

/**
 * Per-clip progress. Each photo is an independent provider job, so the user
 * sees which scenes are ready instead of one spinner for the whole listing.
 */
export function ClipProgressList({ clips }: { clips: PublicClip[] }) {
  if (clips.length === 0) return null;

  const done = clips.filter((c) => c.status === "completed").length;
  const pct = Math.round((done / clips.length) * 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <span className="eyebrow">Renderizando</span>
          <span className="numeric text-micro text-muted">
            {String(done).padStart(2, "0")} / {String(clips.length).padStart(2, "0")}
          </span>
        </div>
        <div className="h-px w-full overflow-hidden bg-line">
          <div
            className="h-full bg-accent transition-[width] duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul className="grid grid-cols-3 gap-2">
        {[...clips]
          .sort((a, b) => a.index - b.index)
          .map((clip) => (
            <li
              key={clip.clipId}
              className="panel relative aspect-[4/3] overflow-hidden"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={clip.imageUrl}
                alt={`Escena ${clip.index + 1}`}
                className={`h-full w-full object-cover transition-all duration-1000 ${
                  clip.status === "completed"
                    ? "scale-100 opacity-100 grayscale-0"
                    : "scale-[1.02] opacity-65 grayscale"
                }`}
              />

              {clip.status === "processing" && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div className="h-full w-1/2 animate-[shimmer_2.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                </div>
              )}

              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2.5 pt-8">
                <span className="numeric text-micro text-white/70">
                  {String(clip.index + 1).padStart(2, "0")}
                </span>
                <span
                  className={`text-micro uppercase tracking-[0.2em] ${
                    clip.status === "completed"
                      ? "text-positive"
                      : clip.status === "failed"
                        ? "text-negative"
                        : clip.status === "processing"
                          ? "text-accent"
                          : "text-white/50"
                  }`}
                >
                  {STATUS_LABEL[clip.status]}
                  {clip.status === "processing" && typeof clip.progress === "number"
                    ? ` ${clip.progress}%`
                    : ""}
                </span>
              </div>

              {clip.status === "failed" && clip.error && (
                <p
                  title={clip.error}
                  className="absolute inset-x-0 top-0 truncate bg-black/70 px-3 py-1.5 text-micro text-negative"
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

/** Compact one-line summary, for the finished state where the grid is noise. */
export function ClipSummary({ clips }: { clips: PublicClip[] }) {
  const failed = clips.filter((c) => c.status === "failed");
  if (clips.length === 0) return null;

  return (
    <p className="text-small text-muted">
      {clips.length - failed.length} de {clips.length} escenas renderizadas
      {failed.length > 0 && (
        <span className={STATUS_TONE.failed}>
          {" "}
          · {failed.length} sin completar
        </span>
      )}
    </p>
  );
}
