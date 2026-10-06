"use client";

import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { PeekNavContext, type PeekNav } from "./peek-nav";

/**
 * A list and its record peek (DESIGN.md §7): the peek is a drawer over the
 * list at every width — full height, scrim, focus kept inside, Esc or a click
 * outside closes it. The list never changes width. ‹ › and ↑/↓ in the drawer
 * move it through the shown rows.
 */
export function ListWithPeek({
  children,
  peek,
  label,
  onClose,
  nav,
}: {
  children: ReactNode;
  /** The peek's content; null when none is open. */
  peek: ReactNode | null;
  /** Accessible name of the drawer ("Zone", "Device"). */
  label: string;
  onClose: () => void;
  nav: PeekNav | null;
}) {
  return (
    <>
      {children}
      <Sheet open={peek != null} onClose={onClose} label={label} widthClassName="w-[min(560px,100vw)]">
        <div data-peek className="flex h-full min-h-0 flex-col">
          <PeekNavContext.Provider value={nav}>{peek}</PeekNavContext.Provider>
        </div>
      </Sheet>
    </>
  );
}
