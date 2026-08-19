"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Reel } from "@/types/video";

/**
 * Plays the montage as a sequential playlist: each clip runs, then the next
 * one starts, giving a continuous reel without server-side concatenation.
 *
 * Once the downloadable file exists, `reel.url` is set and we hand the browser
 * that single video instead.
 */

/**
 * The frame comes from the reel, which got it from the style.
 *
 * This used to be a hard-coded `aspect-video`, which cropped the top and
 * bottom off every vertical reel — and two of the six styles are 9:16, the
 * ones aimed at Reels and TikTok. The preview lied about the deliverable for
 * exactly the formats where the framing is the point.
 */
const ASPECT: Record<string, string> = {
  "16:9": "16 / 9",
  "9:16": "9 / 16",
  "4:5": "4 / 5",
  "1:1": "1 / 1",
};

function frameStyle(aspectRatio: string): CSSProperties {
  return {
    aspectRatio: ASPECT[aspectRatio] ?? "16 / 9",
    // A vertical reel would otherwise run off the bottom of the screen.
    maxHeight: "72vh",
  };
}

export function ReelPlayer({ reel }: { reel: Reel }) {
  const [current, setCurrent] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const segment = reel.segments[current];
  const isLast = current === reel.segments.length - 1;

  const advance = useCallback(() => {
    setCurrent((index) => (index + 1 < reel.segments.length ? index + 1 : index));
  }, [reel.segments.length]);

  // Simulated segments have no footage, so they hold on the photo for their
  // slot's duration and then hand over to the next one.
  useEffect(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = null;

    if (!segment || segment.videoUrl || isLast) return;

    advanceTimer.current = setTimeout(advance, segment.durationSeconds * 1000);

    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, [advance, isLast, segment]);

  // Autoplay each real clip as it becomes current, but not the very first one:
  // browsers block unmuted autoplay before a user gesture.
  useEffect(() => {
    if (current === 0 || !segment?.videoUrl) return;
    videoRef.current?.play().catch(() => {
      /* Autoplay refused — the user can press play. */
    });
  }, [current, segment?.videoUrl]);

  if (!segment) return null;

  // The assembled file is the thing the customer actually takes away, so when
  // it exists it replaces the playlist entirely.
  if (reel.url) {
    return (
      <figure className="rise flex flex-col gap-4">
        <video
          src={reel.url}
          controls
          playsInline
          style={frameStyle(reel.aspectRatio)}
          className="mx-auto w-full rounded-sm border border-line bg-black object-contain shadow-elevated"
        />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <figcaption className="text-small text-muted">
            Vídeo completo · {reel.segments.length} escenas ·{" "}
            {formatTime(reel.totalDurationSeconds)} · {reel.aspectRatio}
          </figcaption>
          <a
            href={reel.url}
            download="video-inmueble.mp4"
            className="inline-flex items-center gap-2 rounded-sm bg-accent px-6 py-2.5 text-micro font-semibold uppercase tracking-[0.2em] text-accent-ink transition-opacity hover:opacity-90"
          >
            Descargar MP4
            <span aria-hidden="true">&darr;</span>
          </a>
        </div>
      </figure>
    );
  }

  return (
    <figure className="rise flex flex-col gap-4">
      <div
        style={frameStyle(reel.aspectRatio)}
        className="relative mx-auto w-full overflow-hidden rounded-sm border border-line bg-black shadow-elevated"
      >
        {segment.videoUrl ? (
          <video
            ref={videoRef}
            key={segment.clipId}
            src={segment.videoUrl}
            controls
            playsInline
            onEnded={advance}
            className="h-full w-full object-cover"
          />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={segment.clipId}
              src={segment.imageUrl}
              alt={`Escena ${segment.index + 1}`}
              className="h-full w-full object-cover animate-[reel-pan_var(--reel-duration)_ease-in-out_forwards]"
              style={
                {
                  "--reel-duration": `${segment.durationSeconds}s`,
                } as CSSProperties
              }
            />
            <span className="absolute right-4 top-4 rounded-full border border-white/20 bg-black/50 px-3 py-1 text-micro uppercase tracking-[0.2em] text-white/80 backdrop-blur-sm">
              Vista previa simulada
            </span>
          </>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/70 to-transparent px-5 pb-4 pt-16">
          <span className="headline text-lead leading-none text-white">
            Escena {String(segment.index + 1).padStart(2, "0")}
          </span>
          <span className="numeric text-micro text-white/60">
            {formatTime(segment.startAtSeconds)} /{" "}
            {formatTime(reel.totalDurationSeconds)}
          </span>
        </div>
      </div>

      {/* Chapter scrubber: one segment per clip, click to jump. */}
      <div className="flex items-center gap-4">
        <div className="flex flex-1 gap-1.5">
          {reel.segments.map((s, index) => (
            <button
              key={s.clipId}
              type="button"
              aria-label={`Ir a la escena ${index + 1}`}
              aria-current={index === current}
              onClick={() => setCurrent(index)}
              className="group relative h-4 flex-1"
            >
              <span
                className={`absolute inset-x-0 top-1.5 h-px transition-colors duration-300 ${
                  index === current
                    ? "bg-accent"
                    : index < current
                      ? "bg-line-strong"
                      : "bg-line group-hover:bg-line-strong"
                }`}
              />
            </button>
          ))}
        </div>
        <figcaption className="shrink-0 numeric text-micro text-faint">
          {String(current + 1).padStart(2, "0")}/
          {String(reel.segments.length).padStart(2, "0")}
        </figcaption>
      </div>

      {reel.stitching && (
        <p className="flex items-center gap-2 text-small text-muted">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Montando el vídeo descargable…
        </p>
      )}

      {reel.stitchError && (
        // Losing the download is not losing the reel — say exactly that.
        <p className="text-small text-muted">
          No se pudo montar el fichero descargable. El recorrido de arriba sigue
          siendo válido.
        </p>
      )}
    </figure>
  );
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
