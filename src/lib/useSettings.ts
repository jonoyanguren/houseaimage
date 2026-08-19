"use client";

import { useCallback, useState } from "react";
import type { BrandSettings, PublicSettings } from "@/types/settings";
import type { PluginConfig } from "@/types/plugin";

/**
 * Client state for the settings panel.
 *
 * Everything it holds came from `/api/settings`, which never returns the API
 * key — so this hook cannot leak one no matter how it is used. What it holds
 * is a *description* of the connection.
 *
 * Seeded from the server rather than fetched on mount: the state is already
 * known when the page renders, and refetching it would flash "sin conectar"
 * on every load. It is refreshed after each change, which is the only time it
 * can differ.
 */
export function useSettings(initial: PublicSettings) {
  const [settings, setSettings] = useState<PublicSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(
    null
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      setSettings((await res.json()) as PublicSettings);
    } catch {
      /* The panel simply stays empty; nothing here is worth an alarm. */
    }
  }, []);

  /** Wrap a call so every action shares the same busy flag and error handling. */
  const run = useCallback(
    async (fn: () => Promise<{ ok: boolean; message: string }>) => {
      setBusy(true);
      setNotice(null);
      try {
        const result = await fn();
        setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
        await load();
        return result.ok;
      } catch (err) {
        setNotice({
          tone: "error",
          text: err instanceof Error ? err.message : "Error desconocido",
        });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const connectProvider = useCallback(
    (pluginId: string, config: PluginConfig) =>
      run(async () => {
        const res = await fetch("/api/settings/provider", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pluginId, config }),
        });
        const data = await res.json();
        return {
          ok: res.ok,
          message: res.ok ? data.message : (data.error ?? "No se pudo conectar"),
        };
      }),
    [run]
  );

  const disconnectProvider = useCallback(
    () =>
      run(async () => {
        const res = await fetch("/api/settings/provider", { method: "DELETE" });
        const data = await res.json();
        return {
          ok: res.ok,
          message: res.ok ? data.message : (data.error ?? "No se pudo desconectar"),
        };
      }),
    [run]
  );

  const saveBrand = useCallback(
    (patch: Partial<BrandSettings>) =>
      run(async () => {
        const res = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        return {
          ok: res.ok,
          message: res.ok ? "Guardado." : (data.error ?? "No se pudo guardar"),
        };
      }),
    [run]
  );

  const uploadLogo = useCallback(
    (file: File) =>
      run(async () => {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/settings/logo", { method: "POST", body });
        const data = await res.json();
        return {
          ok: res.ok,
          message: res.ok ? "Logotipo actualizado." : (data.error ?? "No se pudo subir"),
        };
      }),
    [run]
  );

  return {
    settings,
    busy,
    notice,
    reload: load,
    connectProvider,
    disconnectProvider,
    saveBrand,
    uploadLogo,
  };
}
