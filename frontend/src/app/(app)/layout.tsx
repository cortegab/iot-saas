"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";
import { Sheet } from "@/components/ui/Sheet";
import { AppSidebar } from "@/components/shell/AppSidebar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { ShellContext } from "@/components/shell/shell-context";
import { cn } from "@/lib/cn";

/** The app shell (DESIGN.md §4): a 256px sticky sidebar, and below 1100px a
 * drawer behind a menu button. The content column is 1120px wide, or 1520px
 * for pages that call `useWideContent()`. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { status, currentTenantId, memberships } = useAuth();
  const realtime = useRealtime();
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  // Close the mobile drawer whenever navigation happens.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // ⌘K / Ctrl+K anywhere opens the palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setNavOpen(false);
        setPaletteOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const openPalette = useCallback(() => {
    setNavOpen(false);
    setPaletteOpen(true);
  }, []);
  const openNav = useCallback(() => setNavOpen(true), []);
  const shell = useMemo(() => ({ openPalette, openNav, setWide }), [openPalette, openNav]);

  if (status === "loading") {
    return <div className="flex min-h-screen items-center justify-center text-ink-muted">Loading…</div>;
  }

  // Unauthenticated: the effect above is already redirecting; render nothing to
  // avoid a flash of app chrome with no valid session behind it.
  if (status !== "authenticated" || !currentTenantId) return null;

  const workspaceName = memberships.find((m) => m.tenant_id === currentTenantId)?.tenant_name ?? "";

  return (
    <ShellContext.Provider value={shell}>
      {/* Keyed by tenant: switching workspace remounts every hook so nothing
          from the previous workspace survives (see setCurrentTenantId). */}
      <div key={currentTenantId} className="app-shell grid min-h-screen shell:grid-cols-[256px_minmax(0,1fr)]">
        <aside
          aria-label="Primary"
          className="sticky top-0 z-[60] hidden h-screen overflow-y-auto border-r border-border bg-sidebar shell:block"
        >
          <AppSidebar realtime={realtime} />
        </aside>

        <Sheet open={navOpen} onClose={() => setNavOpen(false)} label="Navigation" side="left" widthClassName="w-[280px] bg-sidebar">
          <AppSidebar realtime={realtime} />
        </Sheet>

        <div className="flex min-w-0 flex-col">
          <div className="sticky top-[env(safe-area-inset-top,0px)] z-20 flex items-center gap-2.5 border-b border-border bg-surface px-4 py-2.5 shell:hidden">
            <button
              type="button"
              onClick={openNav}
              aria-label="Open navigation"
              aria-expanded={navOpen}
              className="grid h-[42px] w-[42px] place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink"
            >
              <Menu aria-hidden size={18} />
            </button>
            <strong className="flex-1 truncate text-sm font-semibold text-ink">{workspaceName}</strong>
            <button
              type="button"
              onClick={openPalette}
              aria-label="Search"
              className="grid h-[42px] w-[42px] place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink"
            >
              <Search aria-hidden size={18} />
            </button>
          </div>

          <main
            id="content"
            className={cn(
              "mx-auto flex w-full flex-col gap-[22px] px-4 pb-[110px] pt-[22px] transition-[max-width] duration-200 md:px-10 md:pt-9",
              wide ? "max-w-[1520px]" : "max-w-[1120px]",
            )}
          >
            {children}
          </main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </ShellContext.Provider>
  );
}
