"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useRealtime } from "@/hooks/useRealtime";
import { AppSidebar } from "@/components/shell/AppSidebar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { NoWorkspace } from "@/components/shell/NoWorkspace";
import { PhoneTabBar, PhoneTopBar, ReconnectingBanner } from "@/components/shell/PhoneNav";
import { ShellContext } from "@/components/shell/shell-context";
import { cn } from "@/lib/cn";

/** The app shell (DESIGN.md §4): the full 256px sidebar from 1440px; the
 * 64px icon rail from 641px, which a pin opens to the full sidebar over the
 * content; and on phones a top bar and a bottom tab bar. The content column
 * is 1120px wide. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { status, currentTenantId } = useAuth();
  const realtime = useRealtime();
  const router = useRouter();
  const isFull = useMediaQuery("(min-width: 1440px)");
  const [pinned, setPinned] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  // ⌘K / Ctrl+K anywhere opens the palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Esc closes a pinned-open sidebar (it lies over the content).
  useEffect(() => {
    if (!pinned || isFull) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) setPinned(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pinned, isFull]);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const shell = useMemo(() => ({ openPalette }), [openPalette]);

  if (status === "loading") {
    return <div className="flex min-h-screen items-center justify-center text-ink-muted">Loading…</div>;
  }

  // Unauthenticated: the effect above is already redirecting; render nothing to
  // avoid a flash of app chrome with no valid session behind it.
  if (status !== "authenticated") return null;
  if (!currentTenantId) return <NoWorkspace />;

  const overlay = !isFull && pinned;

  return (
    <ShellContext.Provider value={shell}>
      {/* Keyed by tenant: switching workspace remounts every hook so nothing
          from the previous workspace survives (see setCurrentTenantId). */}
      <div
        key={currentTenantId}
        className="app-shell grid min-h-screen rail:grid-cols-[64px_minmax(0,1fr)] full:grid-cols-[256px_minmax(0,1fr)]"
      >
        <button
          type="button"
          onClick={() => mainRef.current?.focus()}
          className="sr-only z-[100] rounded-md bg-accent px-3 py-2 text-sm font-medium text-on-accent focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to content
        </button>

        <div className="relative z-[60] hidden rail:block">
          <aside
            aria-label="Primary"
            className={cn(
              "sticky top-0 h-screen border-r border-border bg-sidebar transition-[width] duration-150",
              isFull ? "w-64" : overlay ? "w-64 shadow-pop" : "w-16",
            )}
          >
            <AppSidebar
              realtime={realtime}
              compact={!isFull && !pinned}
              onTogglePin={isFull ? undefined : () => setPinned((p) => !p)}
            />
          </aside>
        </div>

        <div className="flex min-w-0 flex-col">
          <PhoneTopBar realtime={realtime} />

          <main
            ref={mainRef}
            id="content"
            tabIndex={-1}
            className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-[22px] px-4 pb-[calc(110px+var(--tabbar-h))] pt-[22px] outline-none rail:px-10 rail:pt-9"
          >
            <ReconnectingBanner realtime={realtime} />
            {children}
          </main>
        </div>

        <PhoneTabBar realtime={realtime} />
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </ShellContext.Provider>
  );
}
