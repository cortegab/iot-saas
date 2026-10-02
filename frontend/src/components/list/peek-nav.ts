"use client";

import { createContext } from "react";

/** Where the open peek sits in the list, and how to move it — the drawer
 * blocks the list, so browsing happens inside it (DESIGN.md §7). */
export interface PeekNav {
  /** 0-based position in the shown rows; -1 when the record isn't on this page. */
  index: number;
  total: number;
  prev: (() => void) | null;
  next: (() => void) | null;
}

export const PeekNavContext = createContext<PeekNav | null>(null);
