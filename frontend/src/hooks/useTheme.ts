"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const STORAGE_KEY = "iot-saas:theme";

function systemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function readPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("light", theme === "light");
}

/**
 * Reads and writes the theme preference that the inline no-flash script in
 * `app/layout.tsx` bootstraps on load.
 *
 * - `preference` is the stored choice; `"system"` means follow the OS.
 * - `theme` is what's actually rendered right now.
 * - `mounted` is false until the first client effect runs — gate anything that
 *   would otherwise disagree with the server markup on it; never read
 *   `localStorage` in a render body.
 *
 * `setPreference` toggles the `.light` class in the event handler (not an
 * effect) so it stays idempotent and doesn't trigger a second uPlot rebuild
 * under React StrictMode's double-invoke.
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [theme, setThemeState] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const pref = readPreference();
    setPreferenceState(pref);
    setThemeState(pref === "system" ? systemTheme() : pref);
    setMounted(true);
  }, []);

  // Track the OS only while the preference is "system".
  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const next: Theme = mq.matches ? "light" : "dark";
      applyTheme(next);
      setThemeState(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  // Another tab changed the preference.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const pref = readPreference();
      const next: Theme = pref === "system" ? systemTheme() : pref;
      applyTheme(next);
      setPreferenceState(pref);
      setThemeState(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    try {
      if (pref === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // storage unavailable (private mode) — the in-memory state below still works for this session
    }
    const next: Theme = pref === "system" ? systemTheme() : pref;
    applyTheme(next);
    setPreferenceState(pref);
    setThemeState(next);
  }, []);

  return { theme, preference, setPreference, mounted };
}
