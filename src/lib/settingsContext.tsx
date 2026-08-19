"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useSettings } from "@/lib/useSettings";
import type { PublicSettings } from "@/types/settings";

/**
 * One copy of the settings state for the whole shell.
 *
 * The header shows which video backend is in effect and the drawer changes it,
 * so they have to be the same state — otherwise connecting a key leaves the
 * header claiming the app is still simulating.
 */
type SettingsState = ReturnType<typeof useSettings>;

const SettingsContext = createContext<SettingsState | null>(null);

export function SettingsProvider({
  initial,
  children,
}: {
  initial: PublicSettings;
  children: ReactNode;
}) {
  return (
    <SettingsContext.Provider value={useSettings(initial)}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettingsContext(): SettingsState {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error("useSettingsContext debe usarse dentro de <SettingsProvider>");
  }
  return value;
}
