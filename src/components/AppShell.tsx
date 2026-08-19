"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { PublicSettings } from "@/types/settings";
import { Wordmark } from "@/components/brand/Mark";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SettingsProvider, useSettingsContext } from "@/lib/settingsContext";

/**
 * The frame around every screen.
 *
 * Two rows, and the second one is the point: a status strip that states the
 * machine's condition — which engine will render, whether a file can be
 * delivered, whether the door is locked — the way a desk tells you what it is
 * patched into before you touch a fader.
 *
 * None of it is decoration. The difference between a simulated clip and a paid
 * render is invisible in the finished montage, and a host with no ffmpeg gives
 * the customer no file at all. Both are things worth knowing *before* the
 * batch, so the shell says them permanently.
 */
export function AppShell({
  initialSettings,
  children,
}: {
  initialSettings: PublicSettings;
  children: ReactNode;
}) {
  return (
    <SettingsProvider initial={initialSettings}>
      <Shell>{children}</Shell>
    </SettingsProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings } = useSettingsContext();
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3.5 sm:px-8">
          <Wordmark />

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded-sm border border-line px-3 py-1.5 text-micro uppercase tracking-[0.2em] text-muted transition-colors duration-300 hover:border-line-strong hover:text-ink"
            >
              Ajustes
            </button>

            {settings.accessGate && (
              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/auth", { method: "DELETE" });
                  router.push("/entrar");
                  router.refresh();
                }}
                className="hidden text-micro uppercase tracking-[0.2em] text-faint transition-colors hover:text-ink sm:block"
              >
                Salir
              </button>
            )}
          </div>
        </div>

        <StatusStrip />
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 sm:px-8">{children}</main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5 text-micro uppercase tracking-[0.2em] text-faint sm:px-8">
          <span>houseaimage</span>
          <span>Un plano por fotografía</span>
        </div>
      </footer>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/**
 * The instrument strip.
 *
 * Reads left to right in the order the work flows: what renders it, what comes
 * out, who can start it. Values are set in the mono face because they are
 * readings, not prose.
 */
function StatusStrip() {
  const { settings } = useSettingsContext();
  const { connection, accessGate, canDeliverFile } = settings;

  return (
    <div className="border-t border-line-faint bg-surface/40">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-x-6 overflow-x-auto px-6 py-2 sm:px-8">
        <Reading
          label="Motor"
          value={connection.connected ? connection.provider : "simulado"}
          tone={connection.connected ? "live" : "warn"}
          title={
            connection.connected
              ? "Los clips se renderizan de verdad y consumen créditos."
              : "Sin clave de API: los clips se simulan y no se renderiza nada."
          }
        />
        <Reading
          label="Entrega"
          value={canDeliverFile ? "mp4" : "sin fichero"}
          tone={canDeliverFile ? "normal" : "warn"}
          title={
            canDeliverFile
              ? "El servidor puede montar el fichero descargable."
              : "Este host no tiene ffmpeg: el recorrido se reproduce, pero no hay fichero que descargar."
          }
        />
        <Reading
          label="Acceso"
          value={accessGate ? "protegido" : "abierto"}
          tone={accessGate ? "normal" : "warn"}
          title={
            accessGate
              ? "Hace falta el código de acceso para entrar."
              : "Cualquiera que llegue a esta URL puede gastar créditos."
          }
        />
      </div>
    </div>
  );
}

function Reading({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  /** `live` earns the pulsing dot; `warn` earns the brass. */
  tone: "normal" | "live" | "warn";
  title: string;
}) {
  return (
    <span title={title} className="flex shrink-0 items-center gap-2 whitespace-nowrap">
      <span className="eyebrow">{label}</span>
      {tone === "live" && (
        <span
          aria-hidden="true"
          className="live-dot inline-block h-1 w-1 rounded-full bg-positive"
        />
      )}
      <span
        className={`numeric text-micro uppercase ${
          tone === "warn" ? "text-accent" : "text-muted"
        }`}
      >
        {value}
      </span>
    </span>
  );
}
