"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { useWideContent } from "@/components/shell/shell-context";

/** `matchMedia` as state (false during SSR / first render). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const on = () => setMatches(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/**
 * A list with its record editor (DESIGN.md §7): docked beside the list at
 * ≥ 1100px (the content column widens to 1520px), a drawer below. `editor`
 * receives the presentation it's rendered in.
 */
export function SplitView({
  children,
  editor,
  editorLabel,
  onClose,
}: {
  children: ReactNode;
  /** Render prop; null when no editor is open. */
  editor: ((mode: "dock" | "drawer") => ReactNode) | null;
  editorLabel: string;
  onClose: () => void;
}) {
  const wide = useMediaQuery("(min-width: 1100px)");
  const open = editor != null;
  useWideContent(open && wide);

  if (open && wide) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_14px_minmax(440px,580px)] items-start">
        <div className="flex min-w-0 flex-col gap-4 [&_.max-w-\[44ch\]]:max-w-[30ch]">{children}</div>
        <div aria-hidden />
        {editor("dock")}
      </div>
    );
  }
  return (
    <>
      {children}
      <Sheet open={open} onClose={onClose} label={editorLabel}>
        {editor?.("drawer")}
      </Sheet>
    </>
  );
}
