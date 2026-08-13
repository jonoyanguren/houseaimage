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
        className="w-full rounded-lg border border-foreground/10"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-lg border border-foreground/10 bg-black">
        {segment.videoUrl ? (
          <video
            ref={videoRef}
            key={segment.clipId}
            src={segment.videoUrl}
            controls
            playsInline
            onEnded={advance}
            className="w-full"
          />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={segment.clipId}
              src={segment.imageUrl}
              alt={`Escena ${segment.index + 1}`}
              className="w-full animate-[reel-pan_var(--reel-duration)_ease-in-out_forwards]"
              style={
                {
                  "--reel-duration": `${segment.durationSeconds}s`,
                } as CSSProperties
              }
            />
            <span className="absolute right-2 top-2 rounded bg-amber-500/90 px-2 py-0.5 text-[10px] font-medium text-black">
              Simulado — sin credenciales
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1">
          {reel.segments.map((s, index) => (
            <button
              key={s.clipId}
              type="button"
              aria-label={`Ir a la escena ${index + 1}`}
              onClick={() => setCurrent(index)}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                index === current
                  ? "bg-foreground"
                  : index < current
                    ? "bg-foreground/40"
                    : "bg-foreground/15"
              }`}
            />
          ))}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-foreground/60">
          {current + 1}/{reel.segments.length} · {reel.totalDurationSeconds}s
        </span>
      </div>
    </div>
  );
}
