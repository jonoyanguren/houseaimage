"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PluginConfig, PublicPlugin } from "@/types/plugin";
import type { VisionModel } from "@/types/vision";
import { useSettingsContext } from "@/lib/settingsContext";

/**
 * Operator settings, in a drawer over the workspace.
 *
 * This is where the video engine gets connected. Before it existed the only
 * way in was editing `.env.local` and restarting the server, which is not
 * something you hand a customer.
 *
 * The engine section renders itself from the plugin catalogue: each plugin
 * declares the fields it needs and this builds the form from them. Adding a
 * backend therefore adds its inputs without anyone touching this file — which
 * is the whole point of the seam.
 *
 * Two rules the interface has to make visible, because getting them wrong
 * costs money:
 *
 * - With nothing connected the app runs on the **simulated** engine. It must
 *   never look like a real render is happening.
 * - Configuration set in the environment **wins**, and the panel shows it as
 *   locked rather than silently accepting an edit that does nothing.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const {
    settings,
    busy,
    notice,
    connectProvider,
    disconnectProvider,
    saveBrand,
    uploadLogo,
  } = useSettingsContext();

  const { connection, plugins, brand } = settings;

  // Seeded once, on purpose: after that these are the operator's edits, and a
  // save arriving mid-typing must not overwrite the field being typed into.
  const [selectedId, setSelectedId] = useState(
    connection.pluginId ?? plugins[0]?.id ?? ""
  );
  const [config, setConfig] = useState<PluginConfig>(() =>
    seedConfig(connection.values)
  );
  const [agencyName, setAgencyName] = useState(brand.agencyName ?? "");
  const [contact, setContact] = useState(brand.contact ?? "");
  const panelRef = useRef<HTMLDivElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const selected = plugins.find((plugin) => plugin.id === selectedId);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Cerrar ajustes"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Ajustes"
        tabIndex={-1}
        className="rise relative flex h-full w-full max-w-md flex-col border-l border-line bg-canvas outline-none"
      >
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="headline text-lead">Ajustes</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ajustes"
            className="flex h-8 w-8 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            &#10005;
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-7">
          <Section title="Motor de vídeo" hint="Dónde y cómo se renderizan los clips.">
            <div className="panel flex items-center justify-between gap-4 px-4 py-3">
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    connection.connected ? "bg-positive" : "bg-accent"
                  }`}
                />
                <span className="text-small">{connection.label}</span>
              </span>
              {connection.connected ? (
                <span className="numeric text-micro uppercase text-faint">
                  {connection.transport}
                  {connection.keyHint ? ` ····${connection.keyHint}` : ""}
                </span>
              ) : (
                <span className="eyebrow">Sin conectar</span>
              )}
            </div>

            {!connection.connected && (
              <p className="mt-3 text-small leading-relaxed text-muted">
                Sin motor conectado los clips se simulan: verás la fotografía con
                un paneo lento y la etiqueta «Simulado». No se renderiza vídeo ni
                se gasta nada.
              </p>
            )}

            {connection.connected && !connection.verified && (
              <p className="mt-3 text-small leading-relaxed text-muted">
                La configuración está guardada pero no se ha podido comprobar.
                Revísala si los clips empiezan a fallar.
              </p>
            )}

            {connection.locked ? (
              <p className="mt-3 text-small leading-relaxed text-faint">
                Fijado por la variable de entorno{" "}
                <code className="numeric text-label">HIGGSFIELD_API_KEY</code>. Para
                cambiarlo, edita el entorno del servidor.
              </p>
            ) : (
              <div className="mt-5 flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  {plugins.map((plugin) => (
                    <PluginOption
                      key={plugin.id}
                      plugin={plugin}
                      selected={plugin.id === selectedId}
                      onSelect={() => {
                        setSelectedId(plugin.id);
                        // Each plugin has its own fields; carrying values over
                        // would put an API key in a command box.
                        setConfig(
                          plugin.id === connection.pluginId
                            ? seedConfig(connection.values)
                            : {}
                        );
                      }}
                    />
                  ))}
                </div>

                {selected && (
                  <div className="flex flex-col gap-4 border-t border-line-faint pt-5">
                    {selected.fields.map((field) => (
                      <Field key={field.name} label={field.label} hint={field.hint}>
                        <input
                          type={field.kind === "secret" ? "password" : "text"}
                          value={config[field.name] ?? ""}
                          onChange={(e) =>
                            setConfig((current) => ({
                              ...current,
                              [field.name]: e.target.value,
                            }))
                          }
                          placeholder={field.placeholder}
                          autoComplete="off"
                          spellCheck={false}
                          className="numeric w-full rounded-sm border border-line bg-surface-sunken px-3.5 py-2.5 text-small outline-none transition-colors placeholder:text-faint focus:border-line-strong"
                        />
                      </Field>
                    ))}

                    <div className="flex flex-wrap items-center gap-5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => connectProvider(selected.id, config)}
                        className="rounded-sm bg-accent px-6 py-2.5 text-micro font-semibold uppercase tracking-[0.2em] text-accent-ink transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-25"
                      >
                        {busy ? "Comprobando" : "Conectar"}
                      </button>

                      {connection.connected && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={disconnectProvider}
                          className="text-small text-muted underline decoration-line-strong underline-offset-[6px] transition-colors hover:text-ink hover:decoration-accent disabled:opacity-40"
                        >
                          Desconectar
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <p className="mt-4 text-label leading-relaxed text-faint">
              Lo que escribas aquí se guarda en el servidor y nunca vuelve al
              navegador. Se pierde al reiniciar: para que persista, ponlo en el
              entorno.
            </p>
          </Section>

          <VisionSection />

          <Section
            title="Marca de la agencia"
            hint="Se estampa en el vídeo que se descarga."
          >
            <div className="flex flex-col gap-4">
              <Field label="Nombre">
                <input
                  value={agencyName}
                  onChange={(e) => setAgencyName(e.target.value)}
                  placeholder="Fincas del Mar"
                  className="w-full rounded-sm border border-line bg-surface-sunken px-3.5 py-2.5 text-body outline-none transition-colors placeholder:text-faint focus:border-line-strong"
                />
              </Field>

              <Field label="Contacto" hint="Teléfono, web o email para el cierre.">
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="600 000 000 · fincasdelmar.es"
                  className="w-full rounded-sm border border-line bg-surface-sunken px-3.5 py-2.5 text-body outline-none transition-colors placeholder:text-faint focus:border-line-strong"
                />
              </Field>

              <div className="flex items-center gap-4">
                {brand.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={brand.logoUrl}
                    alt="Logotipo de la agencia"
                    className="h-10 w-auto max-w-24 object-contain"
                  />
                ) : (
                  <span className="eyebrow">Sin logotipo</span>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadLogo(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => logoInputRef.current?.click()}
                  className="text-small text-muted underline decoration-line-strong underline-offset-[6px] transition-colors hover:text-ink hover:decoration-accent disabled:opacity-40"
                >
                  {brand.logoUrl ? "Cambiar logotipo" : "Subir logotipo"}
                </button>
              </div>

              <Toggle
                label="Cartón final"
                hint="Cierra el vídeo con el nombre y el contacto."
                checked={brand.endCard}
                disabled={busy}
                onChange={(endCard) => saveBrand({ endCard })}
              />
              <Toggle
                label="Marca de agua"
                hint="Logotipo discreto en una esquina durante todo el vídeo."
                checked={brand.watermark}
                disabled={busy || !brand.logoUrl}
                onChange={(watermark) => saveBrand({ watermark })}
              />

              <button
                type="button"
                disabled={busy}
                onClick={() => saveBrand({ agencyName, contact })}
                className="w-fit rounded-sm border border-line-strong px-6 py-2.5 text-micro font-semibold uppercase tracking-[0.2em] transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
              >
                Guardar marca
              </button>
            </div>
          </Section>

          <Section title="Acceso" hint="Quién puede gastar créditos aquí.">
            {settings.accessGate ? (
              <p className="text-small leading-relaxed text-muted">
                La aplicación está protegida por código de acceso.
              </p>
            ) : (
              <div className="border-l-2 border-negative bg-surface px-4 py-3">
                <p className="text-small leading-relaxed">
                  Sin código de acceso: cualquiera que llegue a esta URL puede
                  generar vídeos con tu clave. Define{" "}
                  <code className="numeric text-label">APP_ACCESS_CODE</code> en el
                  entorno antes de publicarla.
                </p>
              </div>
            )}
          </Section>
        </div>

        {notice && (
          <p
            role="status"
            className={`border-t border-line px-6 py-4 text-small leading-relaxed ${
              notice.tone === "ok" ? "text-positive" : "text-negative"
            }`}
          >
            {notice.text}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Masked values must not be sent back as though they were real.
 *
 * The panel receives `····9876` for a secret, and posting that would store the
 * mask as the key. Non-secret values round-trip; anything masked starts empty,
 * so reconnecting means retyping the secret — which is the correct cost.
 */
function seedConfig(values: Record<string, string>): PluginConfig {
  const seeded: PluginConfig = {};
  for (const [name, value] of Object.entries(values)) {
    if (!value.startsWith("····")) seeded[name] = value;
  }
  return seeded;
}

function PluginOption({
  plugin,
  selected,
  onSelect,
}: {
  plugin: PublicPlugin;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-1 rounded-sm border px-4 py-3 transition-colors duration-300 ${
        selected
          ? "border-accent-line bg-accent-soft"
          : "border-line bg-surface hover:border-line-strong"
      }`}
    >
      <input
        type="radio"
        name="plugin"
        value={plugin.id}
        checked={selected}
        onChange={onSelect}
        className="sr-only"
      />
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-small font-medium">{plugin.label}</span>
        <span
          className={`numeric text-micro uppercase ${
            selected ? "text-accent" : "text-faint"
          }`}
        >
          {plugin.transport}
        </span>
      </span>
      <span className="text-label leading-relaxed text-muted">
        {plugin.description}
      </span>
    </label>
  );
}

/**
 * Who decides what each photograph shows.
 *
 * The choice is between a filename and a model that looks. The copy says that
 * plainly, because the difference is not a preference: it decides whether the
 * scene catalogue fires on every photo or on the two or three whose filename
 * happened to say something.
 *
 * Models are listed rather than typed. Most of a normal library is text-only,
 * and handing a photograph to a text model produces confident nonsense instead
 * of an error — so the ones that cannot see are shown, and disabled.
 */
function VisionSection() {
  const { settings, busy, saveVision, listVisionModels } = useSettingsContext();

  const [driver, setDriver] = useState(settings.vision.driver);
  const [baseUrl, setBaseUrl] = useState(settings.vision.baseUrl ?? "");
  const [model, setModel] = useState(settings.vision.model ?? "");
  const [models, setModels] = useState<VisionModel[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  const lookup = async () => {
    setLooking(true);
    setLookupError(null);
    const result = await listVisionModels(baseUrl.trim() || undefined);
    setModels(result.models ?? null);
    setLookupError(result.error ?? null);
    setLooking(false);
  };

  const withVision = models?.filter((m) => m.vision) ?? [];

  return (
    <Section
      title="Clasificación de fotos"
      hint="Quién decide qué muestra cada fotografía."
    >
      <div className="flex flex-col gap-2">
        <DriverOption
          label="Por nombre de fichero"
          hint="Instantáneo y sin nada que instalar. Acierta con salon-2.jpg y se rinde con IMG_2481.jpg."
          selected={driver === "heuristic"}
          onSelect={() => setDriver("heuristic")}
        />
        <DriverOption
          label="Modelo local (Ollama)"
          hint="Mira la fotografía. Clasifica todas y avisa de planos de planta o fotos borrosas. Las imágenes no salen de tu máquina."
          selected={driver === "ollama"}
          onSelect={() => setDriver("ollama")}
        />
      </div>

      {driver === "ollama" && (
        <div className="mt-5 flex flex-col gap-4 border-t border-line-faint pt-5">
          <Field label="Dirección de Ollama" hint="Vacío para http://127.0.0.1:11434.">
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:11434"
              spellCheck={false}
              className="numeric w-full rounded-sm border border-line bg-surface-sunken px-3.5 py-2.5 text-small outline-none transition-colors placeholder:text-faint focus:border-line-strong"
            />
          </Field>

          <button
            type="button"
            disabled={looking}
            onClick={lookup}
            className="w-fit rounded-sm border border-line-strong px-5 py-2 text-micro font-semibold uppercase tracking-[0.2em] transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {looking ? "Buscando" : "Buscar modelos"}
          </button>

          {lookupError && (
            <p className="text-small leading-relaxed text-negative">{lookupError}</p>
          )}

          {models && withVision.length === 0 && !lookupError && (
            <p className="text-small leading-relaxed text-muted">
              Ninguno de tus modelos ve imágenes. Descarga uno con visión, por
              ejemplo <code className="numeric text-label">ollama pull gemma4</code>.
            </p>
          )}

          {models && models.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {models.map((option) => (
                <label
                  key={option.name}
                  className={`flex items-center justify-between gap-3 rounded-sm border px-3 py-2 ${
                    !option.vision
                      ? "cursor-not-allowed border-line opacity-40"
                      : option.name === model
                        ? "cursor-pointer border-accent-line bg-accent-soft"
                        : "cursor-pointer border-line hover:border-line-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name="vision-model"
                    value={option.name}
                    checked={option.name === model}
                    disabled={!option.vision}
                    onChange={() => setModel(option.name)}
                    className="sr-only"
                  />
                  <span className="numeric truncate text-small">{option.name}</span>
                  <span className="shrink-0 text-micro uppercase tracking-[0.2em] text-faint">
                    {option.vision ? "visión" : "solo texto"}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={busy || (driver === "ollama" && !model)}
        onClick={() => saveVision({ driver, baseUrl, model })}
        className="mt-5 w-fit rounded-sm bg-accent px-6 py-2.5 text-micro font-semibold uppercase tracking-[0.2em] text-accent-ink transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-25"
      >
        Guardar
      </button>
    </Section>
  );
}

function DriverOption({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-1 rounded-sm border px-4 py-3 transition-colors duration-300 ${
        selected
          ? "border-accent-line bg-accent-soft"
          : "border-line bg-surface hover:border-line-strong"
      }`}
    >
      <input
        type="radio"
        name="vision-driver"
        checked={selected}
        onChange={onSelect}
        className="sr-only"
      />
      <span className="text-small font-medium">{label}</span>
      <span className="text-label leading-relaxed text-muted">{hint}</span>
    </label>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-10 last:mb-0">
      <h3 className="eyebrow">{title}</h3>
      <p className="mb-4 mt-1.5 text-small leading-relaxed text-faint">{hint}</p>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-muted">{label}</span>
      {children}
      {hint && <span className="text-label text-faint">{hint}</span>}
    </label>
  );
}

/** Switch drawn as a hairline track, so it belongs to the same drawing. */
function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-6 ${
        disabled ? "opacity-40" : "cursor-pointer"
      }`}
    >
      <span className="flex flex-col gap-1">
        <span className="text-small">{label}</span>
        <span className="text-label leading-relaxed text-faint">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors duration-300 ${
          checked ? "border-accent-line bg-accent-soft" : "border-line bg-surface"
        }`}
      >
        <span
          className={`h-3.5 w-3.5 rounded-full transition-transform duration-300 ${
            checked ? "translate-x-4 bg-accent" : "translate-x-0 bg-faint"
          }`}
        />
      </span>
    </label>
  );
}
