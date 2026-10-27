"use client";

import { createContext, useContext } from "react";

export interface ShellState {
  /** Opens the ⌘K command palette. */
  openPalette: () => void;
}

export const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within the app layout");
  return ctx;
}
