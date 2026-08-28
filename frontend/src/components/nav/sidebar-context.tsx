"use client";

import { createContext, useContext } from "react";

export interface SidebarState {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

export const SidebarContext = createContext<SidebarState | null>(null);

/** The mobile-drawer open state, provided by the app layout. Used by the
 * hamburger in the header and the drawer/backdrop in the layout. */
export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within the app layout");
  return ctx;
}
