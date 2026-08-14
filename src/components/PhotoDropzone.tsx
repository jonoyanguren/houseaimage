"use client";

import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PropertyType, SceneType } from "@/types/video";
import { scenesForProperty, suggestSceneType } from "@/lib/prompts";

export interface PhotoItem {
  id: string;
  file: File;
  previewUrl: string;
  /** What the photo shows; drives the camera movement for its clip. */
  sceneType: SceneType;
}

interface PhotoDropzoneProps {
  photos: PhotoItem[];
  onChange: (photos: PhotoItem[]) => void;
  /** Conditions which scenes are surfaced and how new photos are classified. */
  propertyType: PropertyType;
  disabled?: boolean;
}

export function PhotoDropzone({
  photos,
  onChange,
  propertyType,
  disabled,
}: PhotoDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sceneOptions = scenesForProperty(propertyType);

  const addFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;

      const incoming = Array.from(fileList).filter((file) =>
        file.type.startsWith("image/")
      );
      const total = photos.length + incoming.length;

      // Pre-classify by position so the user never faces an empty selector;
      // every guess stays editable below the thumbnail.
      const newPhotos: PhotoItem[] = incoming.map((file, i) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        sceneType: suggestSceneType(photos.length + i, total, propertyType),
      }));

      onChange([...photos, ...newPhotos]);
    },
    [photos, onChange, propertyType]
  );

  const setSceneType = (id: string, sceneType: SceneType) => {
    onChange(photos.map((p) => (p.id === id ? { ...p, sceneType } : p)));
  };

  const removePhoto = (id: string) => {
    const photo = photos.find((p) => p.id === id);
    // The object URL is ours to release; leaving it leaks the decoded image.
    if (photo) URL.revokeObjectURL(photo.previewUrl);
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

  return (
    <div className="w-full">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (!disabled) addFiles(e.dataTransfer.files);
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-sm border px-8 py-14 text-center transition-all duration-500 ${
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

        <p className="font-display text-xl tracking-tight">
          Arrastra las fotos del inmueble
        </p>
        <p className="mt-1.5 text-[13px] text-muted">
          o selecciónalas desde tu equipo · JPG o PNG
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
          <div className="mt-8 flex items-baseline justify-between">
            <span className="eyebrow">
              Recorrido · {photos.length} {photos.length === 1 ? "escena" : "escenas"}
            </span>
            <span className="text-[13px] text-faint">
              El orden es el del vídeo final
            </span>
          </div>

          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {photos.map((photo, index) => (
              <li key={photo.id} className="rise flex flex-col gap-2">
                <div className="group relative aspect-[4/3] overflow-hidden rounded-sm border border-line bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.previewUrl}
                    alt={`Escena ${index + 1}`}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                  />

                  <span className="absolute left-3 top-3 rounded-sm bg-black/45 px-2 py-0.5 font-mono text-[11px] tracking-widest text-white/90 backdrop-blur-sm">
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  {/*
                    Revealed on hover on a pointer device, but always visible
                    where there is no hover to begin with. A phone showed the
                    photos with no hint that they could be reordered or
                    removed at all — and half the output formats here are
                    vertical, so the phone is the likely device.
                  */}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-8 transition-opacity duration-300 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
                    <div className="flex gap-0.5">
                      <IconButton
                        label={`Mover la escena ${index + 1} antes`}
                        disabled={disabled || index === 0}
                        onClick={() => move(photo.id, -1)}
                      >
                        ←
                      </IconButton>
                      <IconButton
                        label={`Mover la escena ${index + 1} después`}
                        disabled={disabled || index === photos.length - 1}
                        onClick={() => move(photo.id, 1)}
                      >
                        →
                      </IconButton>
                    </div>

                    <IconButton
                      label={`Quitar la escena ${index + 1}`}
                      disabled={disabled}
                      onClick={() => removePhoto(photo.id)}
                    >
                      ✕
                    </IconButton>
                  </div>
                </div>

                <select
                  aria-label={`Tipo de estancia de la escena ${index + 1}`}
                  value={photo.sceneType}
                  disabled={disabled}
                  onChange={(e) =>
                    setSceneType(photo.id, e.target.value as SceneType)
                  }
                  className="w-full cursor-pointer rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[12px] text-muted outline-none transition-colors hover:border-line-strong focus:border-line-strong disabled:opacity-40"
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
      className="flex h-10 w-10 items-center justify-center rounded-sm text-[13px] text-white/80 backdrop-blur-sm transition-colors hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-25 [@media(hover:hover)]:h-7 [@media(hover:hover)]:w-7"
    >
      {children}
    </button>
  );
}
