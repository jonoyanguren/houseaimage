"use client";

import { useState } from "react";
import { PhotoDropzone, type PhotoItem } from "@/components/PhotoDropzone";
import { ClipProgressList } from "@/components/ClipProgressList";
import { ReelPlayer } from "@/components/ReelPlayer";
import { useVideoGeneration } from "@/lib/useVideoGeneration";

export default function Home() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [prompt, setPrompt] = useState("");
  const { state, generate, retryFailed, reset } = useVideoGeneration();

  const isBusy = state.stage === "uploading" || state.stage === "generating";
  const batch = state.batch;
  const failedCount = batch?.clips.filter((c) => c.status === "failed").length ?? 0;

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-8 px-6 py-16 sm:px-16">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Vídeos para anuncios inmobiliarios
          </h1>
          <p className="text-sm text-foreground/60">
            Sube las fotos del inmueble y ordénalas. Cada foto se convierte en un
            clip corto, y los clips se montan en un único vídeo.
          </p>
        </header>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium text-foreground/80">1. Fotos</h2>
          <PhotoDropzone photos={photos} onChange={setPhotos} disabled={isBusy} />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground/80">
            2. Prompt (opcional)
          </h2>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isBusy}
            placeholder="Describe el movimiento de cámara o el estilo, p. ej. «travelling lento hacia la ventana»…"
            rows={3}
            className="rounded-lg border border-foreground/15 bg-transparent p-3 text-sm outline-none focus:border-foreground/40 disabled:opacity-50"
          />
          <p className="text-xs text-foreground/50">
            Se aplica a todos los clips del lote.
          </p>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium text-foreground/80">3. Generar</h2>
          <button
            type="button"
            disabled={photos.length === 0 || isBusy}
            onClick={() => generate(photos, { prompt: prompt || undefined })}
            className="w-fit rounded-full bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-40 dark:hover:bg-[#ccc]"
          >
            {isBusy
              ? "Generando…"
              : `Generar ${photos.length || ""} ${photos.length === 1 ? "clip" : "clips"}`.trim()}
          </button>

          {state.stage === "uploading" && (
            <p className="text-sm text-foreground/60">Subiendo fotos…</p>
          )}

          {batch && isBusy && <ClipProgressList clips={batch.clips} />}

          {state.stage === "error" && state.error && (
            <p className="text-sm text-red-500">{state.error}</p>
          )}

          {state.stage === "done" && batch && (
            <div className="flex flex-col gap-4">
              {batch.status === "partial" && (
                <p className="text-sm text-amber-600 dark:text-amber-500">
                  {failedCount} {failedCount === 1 ? "clip falló" : "clips fallaron"}. El
                  montaje incluye el resto.
                </p>
              )}

              {batch.reel && <ReelPlayer reel={batch.reel} />}

              <ClipProgressList clips={batch.clips} />

              <div className="flex flex-wrap gap-4">
                {failedCount > 0 && (
                  <button
                    type="button"
                    onClick={retryFailed}
                    className="text-sm font-medium text-foreground/60 underline underline-offset-4 hover:text-foreground"
                  >
                    Reintentar los {failedCount} que fallaron
                  </button>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="text-sm font-medium text-foreground/60 underline underline-offset-4 hover:text-foreground"
                >
                  Empezar de nuevo
                </button>
              </div>
            </div>
          )}

          {state.stage === "error" && batch && failedCount > 0 && (
            <button
              type="button"
              onClick={retryFailed}
              className="w-fit text-sm font-medium text-foreground/60 underline underline-offset-4 hover:text-foreground"
            >
              Reintentar
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
