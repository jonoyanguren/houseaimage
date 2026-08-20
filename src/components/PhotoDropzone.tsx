"use client";

import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PropertyType, SceneType } from "@/types/video";
import { classifyPhoto, scenesForProperty, suggestOrder } from "@/lib/prompts";
import { mapWithConcurrency } from "@/lib/concurrency";
import { useSettingsContext } from "@/lib/settingsContext";
import type { PhotoAnalysis } from "@/types/vision";

export interface PhotoItem {
  id: string;
  file: File;
  /** Downscaled preview, not the original — see `thumbnail`. */
  previewUrl: string;
  /** What the photo shows; drives the camera movement for its clip. */
  sceneType: SceneType;
  /** True once a model has looked at it, rather than only its filename. */
  seen?: boolean;
  /** Set when the model thinks this photo is not worth rendering. */
  discard?: boolean;
  discardReason?: string;
}

interface PhotoDropzoneProps {
  photos: PhotoItem[];
  onChange: (photos: PhotoItem[]) => void;
  /**
   * Applied to one photo, by id, whenever the classifier answers.
   *
   * Separate from `onChange` on purpose: the answers arrive one at a time over
   * several seconds, and by then the array this component was given is stale —
   * the user may have removed or reordered photos in between. The owner
   * applies it against the current state instead.
   */
  onAnalyzed: (id: string, analysis: PhotoAnalysis) => void;
  /** Conditions which scenes are surfaced and how new photos are classified. */
  propertyType: PropertyType;
  disabled?: boolean;
}

/**
 * Photos analysed at once.
 *
 * A local model holds the GPU for the length of a request, so asking for three
 * at a time makes each one slower without finishing sooner. Two keeps the
 * queue moving while the labels visibly fill in.
 */
const ANALYSIS_CONCURRENCY = 2;

/** Longest edge of a preview. Big enough for a grid tile, small enough to hold. */
const THUMBNAIL_EDGE = 640;

/**
 * Longest edge of the photograph we upload.
 *
 * The video models render at 720p or 1080p, so a 4000px original is detail
 * nobody will see, paid for twice — once in the upload and once in the
 * vendor's storage.
 */
const UPLOAD_EDGE = 2048;

/**
 * Prepare a photograph: one decode, two outputs.
 *
 * The **upload is re-encoded to JPEG**, and that is not an optimisation — it is
 * a fix. Phones and portals hand out AVIF, HEIC and WebP, and the video model
 * accepts the job and then fails to render it, reporting nothing more useful
 * than "la generación falló en el proveedor". Hours went into looking for that
 * fault in the transport, the credentials and the model, because every test
 * here used a JPEG and every real photograph did not.
 *
 * The browser already has the decoder, and we already pay for a decode to draw
 * the grid. So the same bitmap produces both the tile and the file that gets
 * sent, and every exotic format becomes the one thing every backend reads.
 */
async function prepare(file: File): Promise<{ upload: File; previewUrl: string }> {
  try {
    const bitmap = await createImageBitmap(file);

    const draw = (edge: number): HTMLCanvasElement => {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);

      const context = canvas.getContext("2d");
      if (!context) throw new Error("sin contexto 2d");

      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas;
    };

    const full = draw(UPLOAD_EDGE);
    const previewUrl = draw(THUMBNAIL_EDGE).toDataURL("image/jpeg", 0.72);

    const blob = await new Promise<Blob | null>((resolve) =>
      full.toBlob(resolve, "image/jpeg", 0.9)
    );
    bitmap.close();

    if (!blob) throw new Error("no se pudo codificar");

    // The name keeps its stem: the classifier reads it when a filename says
    // which room this is, and losing that would cost every `cocina-2.avif` its
    // one piece of real evidence.
    const stem = file.name.replace(/\.[^.]+$/, "") || "foto";

    return {
      upload: new File([blob], `${stem}.jpg`, { type: "image/jpeg" }),
      previewUrl,
    };
  } catch {
    // A format the browser itself cannot decode — HEIC on most desktops. The
    // original is sent as it came: it may well fail at the provider, but
    // refusing it here would be worse, and nothing can convert it locally.
    return { upload: file, previewUrl: URL.createObjectURL(file) };
  }
}

export function PhotoDropzone({
  photos,
  onChange,
  onAnalyzed,
  propertyType,
  disabled,
}: PhotoDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sceneOptions = scenesForProperty(propertyType);
  const { settings } = useSettingsContext();
  const visionOn = settings.vision.driver !== "heuristic";

  /**
   * Ask the model what each new photo shows.
   *
   * Fire and forget, after the photos are already on screen: the filename
   * guess is instant and good enough to work with, and the model's answer
   * replaces it a few seconds later. Nothing here can fail loudly — the route
   * falls back to the same heuristic we already applied.
   */
  const analyze = useCallback(
    async (items: PhotoItem[], total: number) => {
      if (!visionOn || items.length === 0) return;

      setAnalyzing(new Set(items.map((item) => item.id)));

      await mapWithConcurrency(items, ANALYSIS_CONCURRENCY, async (item, i) => {
        try {
          const res = await fetch("/api/classify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dataUrl: item.previewUrl,
              fileName: item.file.name,
              index: i,
              total,
              propertyType,
            }),
          });
          if (res.ok) onAnalyzed(item.id, (await res.json()) as PhotoAnalysis);
        } catch {
          /* The filename guess already on screen stands. */
        } finally {
          setAnalyzing((current) => {
            const next = new Set(current);
            next.delete(item.id);
            return next;
          });
        }
      });
    },
    [onAnalyzed, propertyType, visionOn]
  );

  const addFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList) return;

      const incoming = Array.from(fileList).filter((file) =>
        file.type.startsWith("image/")
      );
      if (incoming.length === 0) return;

      const total = photos.length + incoming.length;
      setReading(true);
      let newPhotos: PhotoItem[] = [];

      try {
        newPhotos = await Promise.all(
          incoming.map(async (file, i) => {
            const { upload, previewUrl } = await prepare(file);

            return {
              id: crypto.randomUUID(),
              file: upload,
              previewUrl,
              // The filename is real evidence when it carries a room name, and
              // position is the fallback. Every guess stays editable below the
              // thumbnail.
              sceneType: classifyPhoto({
                fileName: file.name,
                index: photos.length + i,
                total,
                propertyType,
              }),
            };
          })
        );

        onChange([...photos, ...newPhotos]);
      } finally {
        setReading(false);
      }

      // After the grid has them, never before: the point is that the user sees
      // the photos immediately and watches the labels sharpen.
      void analyze(newPhotos, total);
    },
    [photos, onChange, propertyType, analyze]
  );

  const setSceneType = (id: string, sceneType: SceneType) => {
    onChange(photos.map((p) => (p.id === id ? { ...p, sceneType } : p)));
  };

  const removePhoto = (id: string) => {
    const photo = photos.find((p) => p.id === id);
    // Only the fallback path creates an object URL; a data URL has nothing to
    // release and `revokeObjectURL` on one is a no-op.
    if (photo?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(photo.previewUrl);
    onChange(photos.filter((p) => p.id !== id));
  };

  const move = (id: string, direction: -1 | 1) => {
    const index = photos.findIndex((p) => p.id === id);
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= photos.length) return;
    const next = [...photos];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    onChange(next);
  };

  /** Pull `id` out and drop it where `targetId` sits. */
  const reorder = (id: string, targetId: string) => {
    if (id === targetId) return;
    const from = photos.findIndex((p) => p.id === id);
    const to = photos.findIndex((p) => p.id === targetId);
    if (from < 0 || to < 0) return;

    const next = [...photos];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div className="w-full">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          // A photo being dragged within the grid must not light up the
          // file dropzone as though it were an import.
          if (!disabled && !draggingId) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (!disabled && !draggingId) addFiles(e.dataTransfer.files);
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-sm border px-8 py-12 text-center transition-all duration-500 ${
          isDragging
            ? "border-accent bg-accent-soft"
            : "border-line bg-surface hover:border-line-strong"
        } ${disabled ? "pointer-events-none opacity-40" : ""}`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={`mb-4 h-7 w-7 transition-colors duration-500 ${
            isDragging ? "text-accent" : "text-faint group-hover:text-muted"
          }`}
        >
          <path
            d="M3 16.5V6a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 6v12a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18v-1.5Zm0 0 4.6-4.2a1.5 1.5 0 0 1 2 0l3.4 3.1m0 0 2.2-2a1.5 1.5 0 0 1 2 0L21 15.4M15 9h.01"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <p className="headline text-title">
          Arrastra las fotos del inmueble
        </p>
        <p className="mt-1.5 text-small text-muted">
          {reading
            ? "Preparando las fotografías…"
            : "o selecciónalas desde tu equipo · JPG o PNG"}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            // Allow re-picking the same file after a removal.
            e.target.value = "";
          }}
        />
      </div>

      {photos.length > 0 && (
        <>
          <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3">
            <span className="eyebrow">
              Recorrido · {photos.length} {photos.length === 1 ? "escena" : "escenas"}
            </span>
            <span className="flex items-center gap-5">
              {/*
                The recommended order has existed in `src/lib/prompts` from the
                start and was never offered. It follows the path of an actual
                viewing — arrive, main room, the rest, the closer — and it only
                ever runs when asked, because the user's order is the video.
              */}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(suggestOrder(photos))}
                className="text-small text-muted underline decoration-line-strong underline-offset-[6px] transition-colors hover:text-ink hover:decoration-accent disabled:opacity-40"
              >
                Ordenar como una visita
              </button>
              <span className="text-small text-faint">
                El orden es el del vídeo
              </span>
            </span>
          </div>

          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {photos.map((photo, index) => (
              <li
                key={photo.id}
                draggable={!disabled}
                onDragStart={(e) => {
                  setDraggingId(photo.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setOverId(null);
                }}
                onDragOver={(e) => {
                  if (!draggingId) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setOverId(photo.id);
                }}
                onDrop={(e) => {
                  if (!draggingId) return;
                  e.preventDefault();
                  e.stopPropagation();
                  reorder(draggingId, photo.id);
                  setDraggingId(null);
                  setOverId(null);
                }}
                className={`rise flex flex-col gap-2 transition-opacity duration-200 ${
                  draggingId === photo.id ? "opacity-35" : "opacity-100"
                } ${overId === photo.id && draggingId !== photo.id ? "drop-target" : ""}`}
              >
                <div
                  className={`group relative aspect-[4/3] overflow-hidden rounded-sm border border-line bg-surface ${
                    disabled ? "" : "cursor-grab active:cursor-grabbing"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.previewUrl}
                    alt={`Escena ${index + 1}`}
                    draggable={false}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                  />

                  <span className="absolute left-3 top-3 rounded-sm bg-black/45 px-2 py-0.5 numeric text-micro text-white/90 backdrop-blur-sm">
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  {analyzing.has(photo.id) && (
                    <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-sm bg-black/55 px-2 py-1 backdrop-blur-sm">
                      <span
                        aria-hidden="true"
                        className="live-dot inline-block h-1 w-1 rounded-full bg-accent"
                      />
                      <span className="text-micro uppercase tracking-[0.2em] text-white/70">
                        Mirando
                      </span>
                    </span>
                  )}

                  {photo.discard && (
                    /*
                      A warning, never a removal. The model is often right that
                      a floor plan should not be animated — but it is a guess,
                      and throwing away someone's photograph on a guess is not
                      ours to do. The ✕ is right there.
                    */
                    <span
                      title={photo.discardReason}
                      className="absolute inset-x-0 top-0 flex items-center gap-1.5 bg-accent/90 px-2.5 py-1 text-micro uppercase tracking-[0.16em] text-accent-ink"
                    >
                      <span aria-hidden="true">!</span>
                      <span className="truncate normal-case tracking-normal">
                        {photo.discardReason ?? "Quizá no convenga animarla"}
                      </span>
                    </span>
                  )}

                  {/*
                    Revealed on hover on a pointer device, but always visible
                    where there is no hover to begin with. A phone showed the
                    photos with no hint that they could be reordered or
                    removed at all — and half the output formats here are
                    vertical, so the phone is the likely device. The arrows
                    stay even with drag-and-drop: dragging is not reachable
                    from a keyboard and is awkward with a thumb.
                  */}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-8 transition-opacity duration-300 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
                    <div className="flex gap-0.5">
                      <IconButton
                        label={`Mover la escena ${index + 1} antes`}
                        disabled={disabled || index === 0}
                        onClick={() => move(photo.id, -1)}
                      >
                        &larr;
                      </IconButton>
                      <IconButton
                        label={`Mover la escena ${index + 1} después`}
                        disabled={disabled || index === photos.length - 1}
                        onClick={() => move(photo.id, 1)}
                      >
                        &rarr;
                      </IconButton>
                    </div>

                    <IconButton
                      label={`Quitar la escena ${index + 1}`}
                      disabled={disabled}
                      onClick={() => removePhoto(photo.id)}
                    >
                      &#10005;
                    </IconButton>
                  </div>
                </div>

                <select
                  aria-label={`Tipo de estancia de la escena ${index + 1}`}
                  title={
                    photo.seen
                      ? "Clasificada por el modelo mirando la fotografía"
                      : "Deducida del nombre del fichero o de la posición"
                  }
                  value={photo.sceneType}
                  disabled={disabled}
                  onChange={(e) =>
                    setSceneType(photo.id, e.target.value as SceneType)
                  }
                  className={`w-full cursor-pointer rounded-sm border bg-surface-sunken px-2.5 py-1.5 text-label outline-none transition-colors hover:border-line-strong focus:border-line-strong disabled:opacity-40 ${
                    photo.seen ? "border-accent-line text-ink" : "border-line text-muted"
                  }`}
                >
                  {sceneOptions.map((scene) => (
                    <option key={scene.id} value={scene.id}>
                      {scene.label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        // Guard against a click bubbling to any clickable ancestor.
        e.stopPropagation();
        onClick();
      }}
      // 40px minimum on touch: a 28px target is hard to hit with a thumb.
      className="flex h-10 w-10 items-center justify-center rounded-sm text-small text-white/80 backdrop-blur-sm transition-colors hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-25 [@media(hover:hover)]:h-7 [@media(hover:hover)]:w-7"
    >
      {children}
    </button>
  );
}
