"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Cpu,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Moon,
  Plus,
  Search,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useFocusTrap } from "@/components/ui/Sheet";
import { NAV_GROUPS } from "@/components/shell/nav-config";
import { useShellData } from "@/components/shell/useShellData";
import { usePermissions } from "@/hooks/usePermissions";
import { useTheme } from "@/hooks/useTheme";
import type { Action } from "@/lib/permissions";
import { cn } from "@/lib/cn";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
}

const MAX_RESULTS = 40;

/** DESIGN.md §4 ⌘K command palette — navigation and actions in one list:
 * "Go to", "Create" (only what the role may do), theme, and search across
 * devices, rules, templates, dashboards and members. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<PaletteBody onClose={onClose} />, document.body);
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { can } = usePermissions();
  const { theme, setPreference } = useTheme();
  const data = useShellData();
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  useFocusTrap(ref, true);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => router.push(href);
    const out: Command[] = [];
    for (const g of NAV_GROUPS) {
      for (const item of g.items) {
        if (item.requires && !can(item.requires)) continue;
        out.push({ id: `go:${item.href}`, group: "Go to", label: item.label, icon: item.icon, run: go(item.href) });
      }
    }
    const create: { label: string; href: string; icon: LucideIcon; requires: Action }[] = [
      { label: "New dashboard", href: "/dashboards/new", icon: LayoutDashboard, requires: "dashboards.write" },
      { label: "Add device", href: "/devices/new", icon: Cpu, requires: "devices.write" },
      { label: "New rule", href: "/rules/new", icon: ListChecks, requires: "rules.write" },
      { label: "New device template", href: "/templates/new", icon: Boxes, requires: "templates.write" },
      { label: "New zone", href: "/zones?edit=new", icon: MapPin, requires: "zones.write" },
      { label: "Invite member", href: "/members", icon: UserRound, requires: "members.manage" },
      { label: "New API key", href: "/keys", icon: Plus, requires: "keys.manage" },
    ];
    for (const c of create) {
      if (can(c.requires)) out.push({ id: `new:${c.href}`, group: "Create", label: c.label, icon: Plus, run: go(c.href) });
    }
    out.push({
      id: "theme",
      group: "Actions",
      label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      icon: Moon,
      run: () => setPreference(theme === "dark" ? "light" : "dark"),
    });
    for (const d of data.devices) {
      out.push({
        id: `dev:${d.id}`,
        group: "Devices",
        label: d.name,
        hint: d.connection_state === "online" ? "Online" : d.connection_state === "offline" ? "Offline" : "Never connected",
        icon: Cpu,
        run: go(`/devices/${d.id}`),
      });
    }
    for (const r of data.rules) {
      out.push({
        id: `rule:${r.id}`,
        group: "Rules",
        label: r.name,
        hint: r.enabled ? (r.latched ? "Latched" : "Armed") : "Disabled",
        icon: ListChecks,
        run: go(`/rules/${r.id}`),
      });
    }
    for (const t of data.templates) {
      out.push({
        id: `tpl:${t.id}`,
        group: "Device templates",
        label: t.name,
        hint: `${t.metrics.length} metric${t.metrics.length === 1 ? "" : "s"}`,
        icon: Boxes,
        run: go(`/templates/${t.id}`),
      });
    }
    for (const db of data.dashboards) {
      out.push({
        id: `dash:${db.id}`,
        group: "Dashboards",
        label: db.name,
        hint: `${db.layout.length} widget${db.layout.length === 1 ? "" : "s"}`,
        icon: LayoutDashboard,
        run: go(`/dashboards/${db.id}`),
      });
    }
    for (const z of data.zones) {
      out.push({
        id: `zone:${z.id}`,
        group: "Zones",
        label: z.name,
        hint: `${z.device_count} device${z.device_count === 1 ? "" : "s"}`,
        icon: MapPin,
        run: go(`/zones?edit=${z.id}`),
      });
    }
    for (const m of data.members) {
      out.push({ id: `mem:${m.user_id}`, group: "Members", label: m.email, hint: m.role, icon: UserRound, run: go("/members") });
    }
    return out;
  }, [can, data, router, setPreference, theme]);

  const q = query.trim().toLowerCase();
  // Without a query, show navigation and actions only; records appear once you type.
  const items = (
    q
      ? commands.filter((c) => `${c.label} ${c.hint ?? ""} ${c.group}`.toLowerCase().includes(q))
      : commands.filter((c) => c.group === "Go to" || c.group === "Create" || c.group === "Actions")
  ).slice(0, MAX_RESULTS);
  const safeSel = Math.max(0, Math.min(sel, items.length - 1));

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${safeSel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [safeSel]);

  function run(i: number) {
    const c = items[i];
    if (!c) return;
    onClose();
    c.run();
  }

  let lastGroup: string | null = null;
  const rows: ReactNode[] = [];
  items.forEach((c, i) => {
    if (c.group !== lastGroup) {
      lastGroup = c.group;
      rows.push(
        <li
          key={`g:${c.group}`}
          role="presentation"
          className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted"
        >
          {c.group}
        </li>,
      );
    }
    const Icon = c.icon;
    const selected = i === safeSel;
    rows.push(
      <li
        key={c.id}
        id={`${listId}-${i}`}
        data-i={i}
        role="option"
        aria-selected={selected}
        onMouseMove={() => sel !== i && setSel(i)}
        onClick={() => run(i)}
        className={cn(
          "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
          selected && "bg-accent-muted",
        )}
      >
        <Icon aria-hidden size={15} className={selected ? "text-accent" : "text-ink-muted"} />
        <span className="shrink-0 text-ink">{c.label}</span>
        {c.hint && <span className="ml-auto truncate text-right text-xs text-ink-muted">{c.hint}</span>}
      </li>,
    );
  });

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-start justify-center bg-scrim px-4 pt-[12vh] motion-safe:animate-[fade_.12s]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-[min(600px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-border bg-pop shadow-pop"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3 text-ink-muted">
          <Search aria-hidden size={16} />
          <input
            data-autofocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel(Math.min(items.length - 1, safeSel + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel(Math.max(0, safeSel - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(safeSel);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items.length ? `${listId}-${safeSel}` : undefined}
            aria-label="Search or run a command"
            placeholder="Search devices, rules, templates, actions…"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted/70 focus-visible:outline-none"
          />
          <kbd className="rounded border border-b-2 border-border bg-surface-raised px-[5px] font-mono text-[11px]">Esc</kbd>
        </div>
        <ul ref={listRef} id={listId} role="listbox" className="max-h-[min(380px,50vh)] overflow-auto p-1.5">
          {items.length ? (
            rows
          ) : (
            <li role="presentation" className="p-5 text-center text-sm text-ink-muted">
              Nothing matches “{query}”.
            </li>
          )}
        </ul>
        <div className="flex gap-4 border-t border-border px-3.5 py-2 text-[11px] text-ink-muted">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
