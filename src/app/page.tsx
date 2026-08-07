"use client";

import { useState } from "react";
import { PhotoDropzone, type PhotoItem } from "@/components/PhotoDropzone";
import { useVideoGeneration } from "@/lib/useVideoGeneration";

export default function Home() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [prompt, setPrompt] = useState("");
  const { state, generate, reset } = useVideoGeneration();

  const isBusy = state.stage === "uploading" || state.stage === "generating";

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-8 px-6 py-16 sm:px-16">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Fotos a vídeo con Higgsfield
          </h1>
          <p className="text-sm text-foreground/60">
            Sube tus fotos, ordénalas, y genera un vídeo con IA.
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
            placeholder="Describe el estilo o movimiento del vídeo..."
            rows={3}
            className="rounded-lg border border-foreground/15 bg-transparent p-3 text-sm outline-none focus:border-foreground/40 disabled:opacity-50"
          />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium text-foreground/80">3. Generar</h2>
          <button
            type="button"
            disabled={photos.length === 0 || isBusy}
            onClick={() => generate(photos, { prompt: prompt || undefined })}
            className="w-fit rounded-full bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-40 dark:hover:bg-[#ccc]"
          >
            {isBusy ? "Generando..." : "Generar vídeo"}
          </button>

          {state.stage === "uploading" && (
            <p className="text-sm text-foreground/60">Subiendo fotos…</p>
          )}
          {state.stage === "generating" && (
            <p className="text-sm text-foreground/60">
              Higgsfield está generando el vídeo
              {typeof state.progress === "number" ? ` (${state.progress}%)` : "…"}
            </p>
          )}
          {state.stage === "error" && (
            <p className="text-sm text-red-500">{state.error}</p>
          )}
          {state.stage === "done" && state.videoUrl && (
            <div className="flex flex-col gap-3">
              <video
                src={state.videoUrl}
                controls
                className="w-full rounded-lg border border-foreground/10"
              />
              <button
                type="button"
                onClick={reset}
                className="w-fit text-sm font-medium text-foreground/60 underline underline-offset-4 hover:text-foreground"
              >
                Generar otro vídeo
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
