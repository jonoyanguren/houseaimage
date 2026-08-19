"use client";

import type { PublicClip } from "@/types/video";

/**
 * The finished shots, one row each, with the two actions a user actually wants
 * once the reel exists: re-render this one, or take this one on its own.
 *
 * Both were missing. A single bad shot meant regenerating the whole listing —
 * paying again for the nine that were fine — and a clip that worked well on
 * its own could not be lifted out of the montage for a social post.
 */
export function ShotList({
  clips,
  busyClipId,
  onRegenerate,
}: {
  clips: PublicClip[];
  busyClipId?: string;
  onRegenerate: (clipId: string) => void;
}) {
  if (clips.length === 0) return null;

  return (
    <div className="flex flex-col">
      <span className="eyebrow mb-4">Planos</span>

      <ul className="flex flex-col">
        {[...clips]
          .sort((a, b) => a.index - b.index)
          .map((clip) => {
            const busy = busyClipId === clip.clipId;
            const running = clip.status === "queued" || clip.status === "processing";

            return (
              <li
                key={clip.clipId}
                className="flex items-center gap-4 border-b border-line py-3 last:border-b-0"
              >
                <span className="w-6 shrink-0 numeric text-micro text-faint">
                  {String(clip.index + 1).padStart(2, "0")}
                </span>

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={clip.imageUrl}
                  alt=""
                  className={`h-11 w-16 shrink-0 rounded-sm border border-line object-cover transition-opacity duration-500 ${
                    running || busy ? "opacity-50" : "opacity-100"
                  }`}
                />

                <span className="min-w-0 flex-1 truncate text-small text-muted">
                  {clip.simulated && !clip.videoUrl ? "Simulado" : null}
                  {clip.status === "failed" ? (
                    <span className="text-negative">
                      {clip.error ?? "No se pudo generar"}
                    </span>
                  ) : null}
                </span>

                <span className="flex shrink-0 items-center gap-5">
                  {clip.videoUrl && (
                    <a
                      href={clip.videoUrl}
                      download={`plano-${String(clip.index + 1).padStart(2, "0")}.mp4`}
                      className="text-label text-muted underline decoration-line-strong underline-offset-[6px] transition-colors hover:text-ink hover:decoration-accent"
                    >
                      Descargar
                    </a>
                  )}

                  <button
                    type="button"
                    disabled={busy || running}
                    onClick={() => onRegenerate(clip.clipId)}
                    // Says what it costs, because it does cost: this is a new
                    // provider job, not a free undo.
                    title="Vuelve a renderizar este plano. Consume un trabajo del proveedor."
                    className="text-label text-muted underline decoration-line-strong underline-offset-[6px] transition-colors hover:text-ink hover:decoration-accent disabled:pointer-events-none disabled:opacity-30"
                  >
                    {busy || running ? "Generando" : "Regenerar"}
                  </button>
                </span>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
