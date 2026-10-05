"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/ConfirmDialog";

/**
 * The unsaved-changes guard (DESIGN.md §7): warns on reload/close
 * (`beforeunload`), intercepts in-app link clicks, and gives editors a
 * `confirmLeave()` for their own Close/Cancel buttons. Render `dialog` once.
 */
export function useUnsavedGuard(dirty: boolean, what = "this record") {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const confirmLeave = useCallback(async () => {
    if (!dirtyRef.current) return true;
    return confirm(`Your edits to ${what} haven't been saved.`, {
      title: "Discard unsaved changes?",
      confirmLabel: "Discard changes",
      cancelLabel: "Keep editing",
    });
  }, [confirm, what]);

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
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, confirmLeave, router]);

  return { confirmLeave, dialog };
}
