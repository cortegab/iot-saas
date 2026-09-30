"use client";

import { createContext, useContext, useEffect } from "react";

export interface ShellState {
  /** Opens the ⌘K command palette. */
  openPalette: () => void;
  /** Opens the mobile navigation drawer. */
  openNav: () => void;
  setWide: (wide: boolean) => void;
}

export const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within the app layout");
  return ctx;
}

/** Widens the content column to 1520px while the calling page is mounted
 * (DESIGN.md §4: lists with a docked editor, dashboards). */
export function useWideContent(wide = true): void {
  const { setWide } = useShell();
  useEffect(() => {
    setWide(wide);
    return () => setWide(false);
  }, [wide, setWide]);
}
