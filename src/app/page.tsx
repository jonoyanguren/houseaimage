"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { StyleId } from "@/types/video";
import { PhotoDropzone, type PhotoItem } from "@/components/PhotoDropzone";
import { StylePicker } from "@/components/StylePicker";
import { ClipProgressList, ClipSummary } from "@/components/ClipProgressList";
import { ReelPlayer } from "@/components/ReelPlayer";
import { useVideoGeneration } from "@/lib/useVideoGeneration";
import { DEFAULT_STYLE_ID } from "@/lib/prompts";

export default function Home() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [styleId, setStyleId] = useState<StyleId>(DEFAULT_STYLE_ID);
  const [prompt, setPrompt] = useState("");
  const { state, generate, retryFailed, reset } = useVideoGeneration();

  const isBusy = state.stage === "uploading" || state.stage === "generating";
  const batch = state.batch;
  const failedCount = batch?.clips.filter((c) => c.status === "failed").length ?? 0;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6 sm:px-10">
          <span className="font-display text-lg tracking-tight">
            houseaimage
          </span>
          <span className="eyebrow hidden sm:block">
            Estudio de vídeo inmobiliario
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 pb-32 sm:px-10">
        <section className="border-b border-line py-20 sm:py-28">
          <h1 className="max-w-2xl font-display text-5xl leading-[1.05] tracking-[-0.02em] sm:text-6xl">
            De las fotos del anuncio
            <br />
            <span className="italic text-accent">al vídeo del inmueble</span>
          </h1>
          <p className="mt-7 max-w-md text-[15px] leading-relaxed text-muted">
            Cada fotografía se convierte en un plano con movimiento de cámara.
            Los planos se montan en un único recorrido, en el orden que elijas.
          </p>
        </section>

        <div className="flex flex-col gap-20 py-20">
          <Step number="01" title="Selecciona las fotografías">
            <PhotoDropzone photos={photos} onChange={setPhotos} disabled={isBusy} />
          </Step>

          <Step
            number="02"
            title="Elige el estilo"
            hint="Define el movimiento, el formato y la duración de cada plano"
          >
            <StylePicker value={styleId} onChange={setStyleId} disabled={isBusy} />
          </Step>

          <Step
            number="03"
            title="Matices"
            hint="Opcional · se suma al estilo elegido"
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isBusy}
              placeholder="Luz de tarde, ambiente cálido…"
              rows={3}
              className="w-full resize-none rounded-sm border border-line bg-surface p-5 text-[15px] leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-line-strong disabled:opacity-40"
            />
            <p className="mt-3 text-[13px] leading-relaxed text-faint">
              El movimiento de cámara ya lo fijan el estilo y el tipo de estancia.
              Usa esto solo para matizar luz o ambiente.
            </p>
          </Step>

          <Step number="04" title="Genera el recorrido">
            <div className="flex flex-col gap-8">
              <button
                type="button"
                disabled={photos.length === 0 || isBusy}
                onClick={() =>
                  generate(photos, { styleId, prompt: prompt || undefined })
                }
                className="group inline-flex w-fit items-center gap-3 rounded-full bg-accent px-8 py-3.5 text-[13px] font-medium uppercase tracking-[0.14em] text-accent-ink transition-all duration-300 hover:gap-4 disabled:pointer-events-none disabled:opacity-25"
              >
                {isBusy ? "Generando" : "Generar vídeo"}
                <span aria-hidden="true" className="transition-transform">
                  →
                </span>
              </button>

              {state.stage === "uploading" && (
                <p className="text-[13px] text-muted">Subiendo fotografías…</p>
              )}

              {batch && isBusy && <ClipProgressList clips={batch.clips} />}

              {state.stage === "error" && state.error && (
                <div className="rounded-sm border border-line bg-surface p-5">
                  <p className="eyebrow text-negative">No se pudo completar</p>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted">
                    {state.error}
                  </p>
                  {batch && failedCount > 0 && (
                    <TextButton onClick={retryFailed}>Reintentar</TextButton>
                  )}
                </div>
              )}

              {state.stage === "done" && batch && (
                <div className="flex flex-col gap-8">
                  {batch.status === "partial" && (
                    <div className="border-l-2 border-accent bg-accent-soft px-5 py-4">
                      <p className="text-[14px] leading-relaxed">
                        {failedCount}{" "}
                        {failedCount === 1
                          ? "plano no se completó"
                          : "planos no se completaron"}
                        . El montaje incluye el resto.
                      </p>
                    </div>
                  )}

                  {batch.reel && <ReelPlayer reel={batch.reel} />}

                  <div className="flex flex-wrap items-center justify-between gap-6 border-t border-line pt-6">
                    <ClipSummary clips={batch.clips} />
                    <div className="flex flex-wrap gap-6">
                      {failedCount > 0 && (
                        <TextButton onClick={retryFailed}>
                          Reintentar los {failedCount} que faltan
                        </TextButton>
                      )}
                      <TextButton onClick={reset}>Empezar de nuevo</TextButton>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Step>
        </div>
      </main>
    </div>
  );
}

function Step({
  number,
  title,
  hint,
  children,
}: {
  number: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-6 sm:grid-cols-[auto_1fr] sm:gap-12">
      <div className="sm:w-44">
        <span className="font-mono text-[11px] tracking-widest text-accent">
          {number}
        </span>
        <h2 className="mt-2 font-display text-xl leading-snug tracking-tight">
          {title}
        </h2>
        {hint && <p className="mt-1.5 text-[12px] leading-relaxed text-faint">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function TextButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[13px] text-muted underline decoration-line-strong underline-offset-[6px] transition-colors hover:text-ink hover:decoration-accent"
    >
      {children}
    </button>
  );
}
