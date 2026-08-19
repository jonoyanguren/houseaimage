"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Wordmark } from "@/components/brand/Mark";

/**
 * The door.
 *
 * There is one shared access code, not a user account — see
 * `src/lib/auth/session.ts` for why. The copy says what is being protected,
 * because "enter the code" with no reason reads like a paywall on a demo,
 * while "this spends real credits" is the actual stake.
 */
export default function EntrarPage() {
  return (
    <Suspense>
      <AccessForm />
    </Suspense>
  );
}

function AccessForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo entrar");
        return;
      }

      // `volver` comes from the proxy and is always a path on this app, but it
      // is still user-supplied: anything that is not a local path is dropped
      // rather than followed off-site.
      const target = params.get("volver");
      router.replace(target?.startsWith("/") && !target.startsWith("//") ? target : "/");
      router.refresh();
    } catch {
      setError("No se pudo contactar con el servidor");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Wordmark />

        <h1 className="display mt-10 text-section">
          Estudio de vídeo
          <br />
          <span className="text-accent">inmobiliario</span>
        </h1>

        <p className="mt-4 text-body leading-relaxed text-muted">
          Cada vídeo generado aquí consume créditos de renderizado. El acceso
          está restringido por eso.
        </p>

        <form onSubmit={submit} className="mt-10 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="eyebrow">Código de acceso</span>
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-sm border border-line bg-surface-sunken px-4 py-3 numeric text-body outline-none transition-colors focus:border-line-strong"
            />
          </label>

          {error && (
            <p role="alert" className="text-small text-negative">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || code.length === 0}
            className="mt-2 inline-flex w-fit items-center gap-3 rounded-sm bg-accent px-8 py-3 text-micro font-semibold uppercase tracking-[0.2em] text-accent-ink transition-all duration-300 hover:gap-4 disabled:pointer-events-none disabled:opacity-25"
          >
            {busy ? "Entrando" : "Entrar"}
            <span aria-hidden="true">&rarr;</span>
          </button>
        </form>
      </div>
    </div>
  );
}
