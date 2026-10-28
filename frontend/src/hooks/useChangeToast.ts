"use client";

import { useEffect, useRef } from "react";
import { useToast, type ToastOptions } from "@/components/ui/Toast";

/** A toast when a record's state *changes while its page is open* (DESIGN.md
 * §5 Toast): never for the value it had on load. `describe` gets the old and
 * new value and returns the toast, or null for a change not worth one.
 * `recordId` starts over when the page shows another record. */
export function useChangeToast<T>(
  recordId: string | undefined,
  value: T | undefined,
  describe: (prev: T, next: T) => ToastOptions | null,
): void {
  const toast = useToast();
  const prev = useRef<{ id: string; value: T } | undefined>(undefined);
  useEffect(() => {
    if (recordId === undefined || value === undefined) return;
    const before = prev.current?.id === recordId ? prev.current.value : undefined;
    prev.current = { id: recordId, value };
    if (before === undefined || before === value) return;
    const t = describe(before, value);
    if (t) toast(t);
    // `describe` is a fresh closure each render; only a change of value counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, value, toast]);
}
