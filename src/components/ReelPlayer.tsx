"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Reel } from "@/types/video";

/**
 * Plays the montage as a sequential playlist: each clip runs, then the next
 * one starts, giving a continuous reel without server-side concatenation.
 *
 * When a strategy that stitches a real file is added, `reel.url` is set and we
 * hand the browser that single video instead.
 */
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

  if (reel.url) {
    return (
      <video
        src={reel.url}
        controls
        className="w-full rounded-sm border border-line shadow-elevated"
      />
    );
  }

  return (
    <figure className="rise flex flex-col gap-4">
      <div className="relative aspect-video overflow-hidden rounded-sm border border-line bg-black shadow-elevated">
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
            <span className="absolute right-4 top-4 rounded-full border border-white/20 bg-black/50 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-white/80 backdrop-blur-sm">
              Vista previa simulada
            </span>
          </>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/70 to-transparent px-5 pb-4 pt-16">
          <span className="font-display text-lg leading-none text-white">
            Escena {String(segment.index + 1).padStart(2, "0")}
          </span>
          <span className="font-mono text-[11px] tracking-widest text-white/60 tabular-nums">
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
        <figcaption className="shrink-0 font-mono text-[11px] tracking-widest text-faint tabular-nums">
          {String(current + 1).padStart(2, "0")}/
          {String(reel.segments.length).padStart(2, "0")}
        </figcaption>
      </div>
    </figure>
  );
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
