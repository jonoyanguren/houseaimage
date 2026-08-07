"use client";

import { useCallback, useRef, useState } from "react";

export interface PhotoItem {
  id: string;
  file: File;
  previewUrl: string;
}

interface PhotoDropzoneProps {
  photos: PhotoItem[];
  onChange: (photos: PhotoItem[]) => void;
  disabled?: boolean;
}

export function PhotoDropzone({ photos, onChange, disabled }: PhotoDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const newPhotos: PhotoItem[] = Array.from(fileList)
        .filter((file) => file.type.startsWith("image/"))
        .map((file) => ({
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
        }));
      onChange([...photos, ...newPhotos]);
    },
    [photos, onChange]
  );

  const removePhoto = (id: string) => {
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
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          isDragging
            ? "border-foreground bg-foreground/5"
            : "border-foreground/20 hover:border-foreground/40"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        <p className="text-sm font-medium">Arrastra tus fotos aquí</p>
        <p className="mt-1 text-xs text-foreground/60">
          o haz clic para seleccionar archivos (JPG, PNG)
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {photos.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((photo, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-lg border border-foreground/10">
              <img
                src={photo.previewUrl}
                alt={`Foto ${index + 1}`}
                className="h-full w-full object-cover"
              />
              <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {index + 1}
              </span>
              <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-black/50 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  disabled={disabled || index === 0}
                  onClick={() => move(photo.id, -1)}
                  className="rounded px-1.5 py-0.5 text-xs text-white hover:bg-white/20 disabled:opacity-30"
                >
                  ←
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removePhoto(photo.id)}
                  className="rounded px-1.5 py-0.5 text-xs text-white hover:bg-white/20"
                >
                  Quitar
                </button>
                <button
                  type="button"
                  disabled={disabled || index === photos.length - 1}
                  onClick={() => move(photo.id, 1)}
                  className="rounded px-1.5 py-0.5 text-xs text-white hover:bg-white/20 disabled:opacity-30"
                >
                  →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
