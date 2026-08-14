"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoItem } from "@/components/PhotoDropzone";
import type { ClipOptions, PublicBatch } from "@/types/video";

interface State {
  stage: "idle" | "uploading" | "generating" | "done" | "error";
  batch?: PublicBatch;
  error?: string;
}

/** Poll interval, backing off as a batch drags on to keep long jobs cheap. */
const POLL_MIN_MS = 2_000;
const POLL_MAX_MS = 10_000;

function nextInterval(previous: number) {
  return Math.min(Math.round(previous * 1.25), POLL_MAX_MS);
}

export function useVideoGeneration() {
  const [state, setState] = useState<State>({ stage: "idle" });

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Guards against a late response from an abandoned run overwriting the
  // state of a newer one.
  const runIdRef = useRef(0);

  const stop = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const pollBatch = useCallback((batchId: string, runId: number) => {
    let interval = POLL_MIN_MS;

    const tick = async () => {
      if (runId !== runIdRef.current) return;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`/api/generate/${batchId}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (runId !== runIdRef.current) return;

        if (!res.ok) throw new Error(data.error ?? "Error consultando el estado");

        const batch = data as PublicBatch;

        if (batch.status === "processing") {
          setState({ stage: "generating", batch });
          interval = nextInterval(interval);
          pollTimer.current = setTimeout(tick, interval);
          return;
        }

        // Rendering is done but the downloadable file is still being
        // assembled. Show the playlist now — it is already watchable — and
        // keep polling so the download appears when it is ready.
        if (batch.reel?.stitching) {
          setState({ stage: "done", batch });
          interval = nextInterval(interval);
          pollTimer.current = setTimeout(tick, interval);
          return;
        }

        if (batch.status === "failed") {
          setState({
            stage: "error",
            batch,
            error: "No se pudo generar ningún clip.",
          });
          return;
        }

        // completed or partial — a partial batch still has a watchable reel.
        setState({ stage: "done", batch });
      } catch (err) {
        if (controller.signal.aborted || runId !== runIdRef.current) return;
        setState({
          stage: "error",
          error: err instanceof Error ? err.message : "Error desconocido",
        });
      }
    };

    tick();
  }, []);

  const generate = useCallback(
    async (photos: PhotoItem[], options?: ClipOptions) => {
      stop();
      const runId = ++runIdRef.current;
      setState({ stage: "uploading" });

      try {
        const formData = new FormData();
        photos.forEach((p) => formData.append("files", p.file));

        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (runId !== runIdRef.current) return;
        if (!uploadRes.ok) throw new Error(uploadData.error ?? "Error subiendo las fotos");

        setState({ stage: "generating" });

        // The upload preserves order, so index i of the response is photo i —
        // which is what pairs each URL with the scene the user chose for it.
        const payloadPhotos = (uploadData.urls as string[]).map((imageUrl, i) => ({
          imageUrl,
          sceneType: photos[i]?.sceneType,
        }));

        const createRes = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: payloadPhotos, options }),
        });
        const batch = await createRes.json();
        if (runId !== runIdRef.current) return;
        if (!createRes.ok) throw new Error(batch.error ?? "Error iniciando la generación");

        setState({ stage: "generating", batch });
        pollBatch(batch.batchId, runId);
      } catch (err) {
        if (runId !== runIdRef.current) return;
        setState({
          stage: "error",
          error: err instanceof Error ? err.message : "Error desconocido",
        });
      }
    },
    [pollBatch, stop]
  );

  /** Re-render only the clips that failed, keeping the ones that worked. */
  const retryFailed = useCallback(async () => {
    const batchId = state.batch?.batchId;
    if (!batchId) return;

    stop();
    const runId = ++runIdRef.current;

    try {
      const res = await fetch(`/api/generate/${batchId}`, { method: "POST" });
      const batch = await res.json();
      if (runId !== runIdRef.current) return;
      if (!res.ok) throw new Error(batch.error ?? "Error reintentando los clips");

      setState({ stage: "generating", batch });
      pollBatch(batchId, runId);
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setState({
        stage: "error",
        error: err instanceof Error ? err.message : "Error desconocido",
      });
    }
  }, [pollBatch, state.batch?.batchId, stop]);

  const reset = useCallback(() => {
    stop();
    runIdRef.current++;
    setState({ stage: "idle" });
  }, [stop]);

  return { state, generate, retryFailed, reset };
}
