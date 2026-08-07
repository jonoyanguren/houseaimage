"use client";

import { useCallback, useRef, useState } from "react";
import type { PhotoItem } from "@/components/PhotoDropzone";
import type { GenerateVideoOptions, GenerationStatus } from "@/types/higgsfield";

interface State {
  stage: "idle" | "uploading" | "generating" | "done" | "error";
  status?: GenerationStatus;
  progress?: number;
  videoUrl?: string;
  error?: string;
}

const POLL_INTERVAL_MS = 3000;

export function useVideoGeneration() {
  const [state, setState] = useState<State>({ stage: "idle" });
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const pollJob = useCallback(
    (jobId: string) => {
      const tick = async () => {
        try {
          const res = await fetch(`/api/generate/${jobId}`);
          const data = await res.json();

          if (!res.ok) throw new Error(data.error ?? "Error consultando el estado");

          if (data.status === "completed") {
            setState({ stage: "done", status: "completed", videoUrl: data.videoUrl });
            return;
          }
          if (data.status === "failed") {
            setState({ stage: "error", status: "failed", error: data.error ?? "La generación falló" });
            return;
          }

          setState({ stage: "generating", status: data.status, progress: data.progress });
          pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
        } catch (err) {
          setState({
            stage: "error",
            error: err instanceof Error ? err.message : "Error desconocido",
          });
        }
      };

      tick();
    },
    []
  );

  const generate = useCallback(
    async (photos: PhotoItem[], options?: GenerateVideoOptions) => {
      stopPolling();
      setState({ stage: "uploading" });

      try {
        const formData = new FormData();
        photos.forEach((p) => formData.append("files", p.file));

        const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.error ?? "Error subiendo las fotos");

        setState({ stage: "generating", status: "queued" });

        const generateRes = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrls: uploadData.urls, options }),
        });
        const generateData = await generateRes.json();
        if (!generateRes.ok) throw new Error(generateData.error ?? "Error iniciando la generación");

        pollJob(generateData.jobId);
      } catch (err) {
        setState({
          stage: "error",
          error: err instanceof Error ? err.message : "Error desconocido",
        });
      }
    },
    [pollJob, stopPolling]
  );

  const reset = useCallback(() => {
    stopPolling();
    setState({ stage: "idle" });
  }, [stopPolling]);

  return { state, generate, reset };
}
