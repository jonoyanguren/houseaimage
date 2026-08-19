"use client";

import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PropertyType, StyleId } from "@/types/video";
import { PhotoDropzone, type PhotoItem } from "@/components/PhotoDropzone";
import { PropertyPicker } from "@/components/PropertyPicker";
import { StylePicker } from "@/components/StylePicker";
import { ClipProgressList, ClipSummary } from "@/components/ClipProgressList";
import { ReelPlayer } from "@/components/ReelPlayer";
import { ShotList } from "@/components/ShotList";
import { useVideoGeneration } from "@/lib/useVideoGeneration";
import { DEFAULT_PROPERTY_TYPE, getStyle, stylesForProperty } from "@/lib/prompts";
import type { PhotoAnalysis } from "@/types/vision";
import type { CostEstimate } from "@/types/video";

/**
 * The workspace.
 *
 * Laid out as a two-column studio rather than one long form: the decisions on
 * the left, and a rail on the right that always shows what they add up to —
 * format, number of shots, running time — with the action that spends money at
 * the bottom of it. The old single column meant the user pressed "generate"
 * having scrolled past the format they were choosing.
 */
export function Studio() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [propertyType, setPropertyType] =
    useState<PropertyType>(DEFAULT_PROPERTY_TYPE);
  const [styleId, setStyleId] = useState<StyleId>(
    () => stylesForProperty(DEFAULT_PROPERTY_TYPE)[0].style.id
  );
  const [prompt, setPrompt] = useState("");
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  /** The last combination quoted, so an ordinary reorder does not re-ask. */
  const quotedRef = useRef("");
  const { state, busyClipId, generate, retryFailed, regenerateClip, reset } =
    useVideoGeneration();

  /**
   * Ask what this batch would cost.
   *
   * Driven from the handlers that change the answer rather than from an
   * effect: the price depends on exactly two things — how many photographs
   * there are and which style fixes the frame and the shot length — and both
   * arrive through a handler. An effect would fire on every unrelated render
   * and, worse, would need a state update after paint.
   *
   * Silence is the correct outcome when a backend cannot quote. An absent
   * number is better than an invented one.
   */
  const refreshEstimate = useCallback(async (style: StyleId, clips: number) => {
    const key = `${style}|${clips}`;
    if (quotedRef.current === key) return;
    quotedRef.current = key;

    if (clips === 0) {
      setEstimate(null);
      return;
    }

    try {
      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styleId: style, clips }),
      });
      const data = await res.json();
      setEstimate(data.estimate ?? null);
    } catch {
      setEstimate(null);
    }
  }, []);

  const changePhotos = useCallback(
    (next: PhotoItem[]) => {
      setPhotos(next);
      void refreshEstimate(styleId, next.length);
    },
    [refreshEstimate, styleId]
  );

  /**
   * Fold one classifier answer into the photo it belongs to.
   *
   * Applied here rather than in the dropzone because the answers arrive over
   * several seconds, and by then the array the dropzone was handed is stale —
   * the user may have removed or reordered photos while the model worked. A
   * functional update against the current state is the only version that
   * cannot lose an edit.
   */
  const applyAnalysis = useCallback((id: string, analysis: PhotoAnalysis) => {
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === id
          ? {
              ...photo,
              // Only a real look upgrades the scene; a heuristic answer from
              // the server is the same guess the tile already shows.
              sceneType:
                analysis.source === "vision" ? analysis.sceneType : photo.sceneType,
              seen: analysis.source === "vision",
              discard: analysis.discard,
              discardReason: analysis.reason,
            }
          : photo
      )
    );
  }, []);

  /**
   * Changing the property type moves the style to that property's best match.
   * Leaving a drone reel selected after switching to a flat would silently
   * produce the wrong video.
   */
  const changePropertyType = (next: PropertyType) => {
    setPropertyType(next);
    const style = stylesForProperty(next)[0].style.id;
    setStyleId(style);
    void refreshEstimate(style, photos.length);
  };

  const changeStyle = (next: StyleId) => {
    setStyleId(next);
    void refreshEstimate(next, photos.length);
  };

  const isBusy = state.stage === "uploading" || state.stage === "generating";
  const batch = state.batch;
  const style = getStyle(styleId);
  const failedCount = batch?.clips.filter((c) => c.status === "failed").length ?? 0;

  return (
    <div className="pb-24">
      <section className="border-b border-line py-12 sm:py-16">
        <span className="eyebrow">Estudio de vídeo inmobiliario</span>
        <h1 className="display mt-5 max-w-3xl text-section sm:text-display">
          De las fotos del anuncio{" "}
          {/*
            The accent does the work a serif used to do, and the jump from the
            10px label above to this is where the whole design lives.
          */}
          <span className="text-accent">al vídeo del inmueble</span>
        </h1>
        <p className="mt-6 max-w-md text-body leading-relaxed text-muted">
          Cada fotografía se convierte en un plano con movimiento de cámara. Los
          planos se montan en un único recorrido, en el orden que elijas.
        </p>
      </section>

      <div className="grid gap-x-12 gap-y-10 py-12 lg:grid-cols-[minmax(0,1fr)_288px]">
        <div className="flex min-w-0 flex-col gap-12">
          <Step
            number="01"
            title="Tipo de inmueble"
            hint="Condiciona el estilo, las estancias y el encuadre"
          >
            <PropertyPicker
              value={propertyType}
              onChange={changePropertyType}
              disabled={isBusy}
            />
          </Step>

          <Step
            number="02"
            title="Fotografías"
            hint="Arrástralas para cambiar el orden del recorrido"
          >
            <PhotoDropzone
              photos={photos}
              onChange={changePhotos}
              onAnalyzed={applyAnalysis}
              propertyType={propertyType}
              disabled={isBusy}
            />
          </Step>

          <Step
            number="03"
            title="Estilo"
            hint="Define el movimiento, el formato y la duración de cada plano"
          >
            <StylePicker
              value={styleId}
              propertyType={propertyType}
              onChange={changeStyle}
              disabled={isBusy}
            />
          </Step>

          <Step
            number="04"
            title="Matices"
            hint="Opcional · se suma al estilo elegido"
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isBusy}
              placeholder="Luz de tarde, ambiente cálido…"
              rows={3}
              className="w-full resize-none rounded-sm border border-line bg-surface-sunken p-4 text-body leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-line-strong disabled:opacity-40"
            />
            <p className="mt-3 text-small leading-relaxed text-faint">
              El movimiento de cámara ya lo fijan el estilo y el tipo de
              estancia. Usa esto solo para matizar luz o ambiente.
            </p>
          </Step>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-32 lg:self-start">
          <div className="panel flex flex-col gap-5 p-5">
            <span className="eyebrow">Resumen</span>

            <dl className="flex flex-col gap-2.5 text-small">
              <Row label="Formato" value={style.aspectRatio} />
              <Row
                label="Duración del plano"
                value={`${style.durationSeconds.toFixed(1)} s`}
              />
              <Row
                label="Escenas"
                value={String(photos.length).padStart(2, "0")}
              />
              <Row
                label="Vídeo final"
                value={
                  photos.length > 0
                    ? formatTime(photos.length * style.durationSeconds)
                    : "—"
                }
              />
            </dl>

            {estimate ? (
              <div className="border-t border-line-faint pt-4">
                <div className="flex items-baseline justify-between gap-4 text-small">
                  <span className="text-muted">Coste estimado</span>
                  <span className="numeric text-label uppercase text-accent">
                    {formatCredits(estimate.total)}
                  </span>
                </div>
                <p className="mt-1.5 text-label leading-relaxed text-faint">
                  {formatCredits(estimate.perClip)} por plano · lo cotiza el
                  proveedor, no lo calculamos aquí.
                </p>
                {estimate.note && (
                  <p className="mt-2 text-label leading-relaxed text-accent">
                    {estimate.note}
                  </p>
                )}
              </div>
            ) : (
              <p className="border-t border-line-faint pt-4 text-label leading-relaxed text-faint">
                Cada fotografía es un trabajo de renderizado independiente.
              </p>
            )}

            <button
              type="button"
              disabled={photos.length === 0 || isBusy}
              onClick={() =>
                generate(photos, {
                  styleId,
                  propertyType,
                  prompt: prompt || undefined,
                })
              }
              className="group inline-flex w-full items-center justify-center gap-3 rounded-sm bg-accent px-6 py-3 text-micro font-semibold uppercase tracking-[0.2em] text-accent-ink transition-all duration-300 hover:gap-4 disabled:pointer-events-none disabled:opacity-25"
            >
              {isBusy ? "Generando" : "Generar vídeo"}
              <span aria-hidden="true">&rarr;</span>
            </button>

            {state.stage === "uploading" && (
              <p className="text-small text-muted">Subiendo fotografías…</p>
            )}

            {batch && isBusy && <ClipProgressList clips={batch.clips} />}
          </div>
        </aside>
      </div>

      {state.stage === "error" && state.error && (
        <div className="panel p-5">
          <p className="eyebrow text-negative">No se pudo completar</p>
          <p className="mt-2 text-body leading-relaxed text-muted">
            {state.error}
          </p>
          {batch && failedCount > 0 && (
            <TextButton onClick={retryFailed}>Reintentar</TextButton>
          )}
        </div>
      )}

      {state.stage === "done" && batch && (
        <section className="flex flex-col gap-8 border-t border-line pt-12">
          {batch.status === "partial" && (
            <div className="border-l-2 border-accent bg-accent-soft px-5 py-3.5">
              <p className="text-body leading-relaxed">
                {failedCount}{" "}
                {failedCount === 1
                  ? "plano no se completó"
                  : "planos no se completaron"}
                . El montaje incluye el resto.
              </p>
            </div>
          )}

          {batch.reel && <ReelPlayer reel={batch.reel} />}

          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_288px]">
            <ShotList
              clips={batch.clips}
              busyClipId={busyClipId}
              onRegenerate={regenerateClip}
            />

            <div className="flex flex-col gap-5 self-start">
              <ClipSummary clips={batch.clips} />
              {failedCount > 0 && (
                <TextButton onClick={retryFailed}>
                  Reintentar los {failedCount} que faltan
                </TextButton>
              )}
              <TextButton onClick={reset}>Empezar de nuevo</TextButton>
            </div>
          </div>
        </section>
      )}
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
    <section className="grid gap-5 border-t border-line-faint pt-8 sm:grid-cols-[auto_1fr] sm:gap-10">
      <div className="sm:w-36">
        <span className="numeric text-micro text-accent">{number}</span>
        <h2 className="headline mt-2 text-lead">{title}</h2>
        {hint && (
          <p className="mt-1.5 text-label leading-relaxed text-faint">{hint}</p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** One line of the summary rail. Numbers in mono so they don't dance. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="numeric text-label tracking-widest">
        {value}
      </dd>
    </div>
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
      className="w-fit text-small text-muted underline decoration-line-strong underline-offset-[6px] transition-colors hover:text-ink hover:decoration-accent"
    >
      {children}
    </button>
  );
}

/** Credits, without a trailing `,0` on a whole number. */
function formatCredits(credits: number): string {
  const rounded = Math.round(credits * 10) / 10;
  return `${rounded.toLocaleString("es-ES")} créditos`;
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
