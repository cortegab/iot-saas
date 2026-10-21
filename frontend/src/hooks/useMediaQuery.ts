"use client";

import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches, kept live. False on the server, so
 * anything that renders differently must not be part of the hydrated HTML
 * (the app shell renders only after auth has loaded, which is client-side). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
