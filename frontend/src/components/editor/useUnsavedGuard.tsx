"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/ConfirmDialog";

/**
 * The unsaved-changes guard (DESIGN.md §7): warns on reload/close
 * (`beforeunload`), intercepts in-app link clicks, and gives editors a
 * `confirmLeave()` for their own Close/Cancel buttons. Render `dialog` once.
 */
export interface GuardCopy {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Also warn on reload and close. Off when what is guarded survives a
   * reload (the Connect flow's credential). Default true. */
  onUnload?: boolean;
}

export function useUnsavedGuard(dirty: boolean, what = "this record", copy?: GuardCopy) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const confirmLeave = useCallback(async () => {
    if (!dirtyRef.current) return true;
    return copy
      ? confirm(copy.body, { title: copy.title, confirmLabel: copy.confirmLabel, cancelLabel: copy.cancelLabel })
      : confirm(`Your edits to ${what} haven't been saved.`, {
          title: "Discard unsaved changes?",
          confirmLabel: "Discard changes",
          cancelLabel: "Keep editing",
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm, what, copy?.title, copy?.body]);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    // Capture phase so we see the click before Next's <Link> navigates.
    function onClick(e: MouseEvent) {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      void confirmLeave().then((ok) => {
        if (ok) {
          dirtyRef.current = false;
          router.push(url.pathname + url.search + url.hash);
        }
      });
    }
    const onUnload = copy?.onUnload ?? true;
    if (onUnload) window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, confirmLeave, router, copy?.onUnload]);

  return { confirmLeave, dialog };
}
