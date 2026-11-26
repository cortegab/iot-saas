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
import { NAV_GROUPS, navLabel, navVisible } from "@/components/shell/nav-config";
import { useInterfaceMode } from "@/hooks/useInterfaceMode";
import { usePaletteData } from "@/components/shell/useShellData";
import { usePermissions } from "@/hooks/usePermissions";
import { useTheme } from "@/hooks/useTheme";
import type { Action } from "@/lib/permissions";
import { cn } from "@/lib/cn";
import { useT, type MessageKey } from "@/lib/i18n";

type Group = "goTo" | "actions" | "devices" | "rules" | "templates" | "dashboards" | "zones" | "members";

interface Command {
  id: string;
  group: Group;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
}

const MAX_RESULTS = 40;

/** DESIGN.md §4 ⌘K command palette — navigation and actions in one list:
 * "Go to" and "Actions" (creating only what the role may do; the theme), and search across
 * devices, rules, templates, dashboards and members. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<PaletteBody onClose={onClose} />, document.body);
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { can } = usePermissions();
  const { theme, setPreference } = useTheme();
  const data = usePaletteData();
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  useFocusTrap(ref, true);

  const { simple } = useInterfaceMode();
  const t = useT();
  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => router.push(href);
    const out: Command[] = [];
    for (const g of NAV_GROUPS) {
      for (const item of g.items) {
        if (!navVisible(item, can, simple)) continue;
        out.push({ id: `go:${item.href}`, group: "goTo", label: navLabel(item, simple, t), icon: item.icon, run: go(item.href) });
      }
    }
    const create: { label: MessageKey; href: string; icon: LucideIcon; requires: Action }[] = [
      { label: "palette.actions.newDashboard", href: "/dashboards/new", icon: LayoutDashboard, requires: "dashboards.write" },
      { label: "palette.actions.addDevice", href: "/devices/new", icon: Cpu, requires: "devices.write" },
      { label: "palette.actions.newRule", href: "/rules/new", icon: ListChecks, requires: "rules.write" },
      { label: "palette.actions.newTemplate", href: "/templates/new", icon: Boxes, requires: "templates.write" },
      { label: "palette.actions.newZone", href: "/zones/new", icon: MapPin, requires: "zones.write" },
      { label: "palette.actions.inviteMember", href: "/members/invite", icon: UserRound, requires: "members.manage" },
      { label: "palette.actions.newKey", href: "/keys/new", icon: Plus, requires: "keys.manage" },
    ];
    for (const c of create) {
      if (can(c.requires)) out.push({ id: `new:${c.href}`, group: "actions", label: t(c.label), icon: Plus, run: go(c.href) });
    }
    out.push({
      id: "theme",
      group: "actions",
      label: theme === "dark" ? t("shell.theme.toLight") : t("shell.theme.toDark"),
      icon: Moon,
      run: () => setPreference(theme === "dark" ? "light" : "dark"),
    });
    for (const d of data.devices) {
      out.push({
        id: `dev:${d.id}`,
        group: "devices",
        label: d.name,
        hint: t(d.connection_state === "online" ? "palette.hints.online" : d.connection_state === "offline" ? "palette.hints.offline" : "palette.hints.neverConnected"),
        icon: Cpu,
        run: go(`/devices/${d.id}`),
      });
    }
    for (const r of data.rules) {
      out.push({
        id: `rule:${r.id}`,
        group: "rules",
        label: r.name,
        hint: t(r.enabled ? (r.latched ? "palette.hints.latched" : "palette.hints.armed") : "palette.hints.disabled"),
        icon: ListChecks,
        run: go(`/rules/${r.id}`),
      });
    }
    for (const tpl of data.templates) {
      out.push({
        id: `tpl:${tpl.id}`,
        group: "templates",
        label: tpl.name,
        hint: t("palette.hints.metrics", { count: tpl.metrics.length }),
        icon: Boxes,
        run: go(`/templates/${tpl.id}`),
      });
    }
    for (const db of data.dashboards) {
      out.push({
        id: `dash:${db.id}`,
        group: "dashboards",
        label: db.name,
        hint: t("palette.hints.widgets", { count: db.layout.length }),
        icon: LayoutDashboard,
        run: go(`/dashboards/${db.id}`),
      });
    }
    for (const z of data.zones) {
      out.push({
        id: `zone:${z.id}`,
        group: "zones",
        label: z.name,
        hint: t("common.deviceCount", { count: z.device_count }),
        icon: MapPin,
        run: go(`/zones/${z.id}`),
      });
    }
    for (const m of data.members) {
      out.push({ id: `mem:${m.user_id}`, group: "members", label: m.email, hint: m.role === "owner" || m.role === "admin" || m.role === "viewer" ? t(`roles.${m.role}`) : m.role, icon: UserRound, run: go(`/members/${m.user_id}`) });
    }
    return out;
  }, [can, data, router, setPreference, simple, t, theme]);

  const q = query.trim().toLowerCase();
  // Without a query: navigation, a few records and actions; everything else once you type.
  const items = (
    q
      ? commands.filter((c) => `${c.label} ${c.hint ?? ""} ${t(`palette.groups.${c.group}`)}`.toLowerCase().includes(q))
      : [
          // Before you type (demo H): where to go, a few devices and rules, then actions.
          ...commands.filter((c) => c.group === "goTo"),
          ...commands.filter((c) => c.group === "devices").slice(0, 3),
          ...commands.filter((c) => c.group === "rules").slice(0, 3),
          ...commands.filter((c) => c.group === "actions"),
        ]
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

  let lastGroup: Group | null = null;
  const rows: ReactNode[] = [];
  items.forEach((c, i) => {
    if (c.group !== lastGroup) {
      lastGroup = c.group;
      rows.push(
        <li
          key={`g:${c.group}`}
          role="presentation"
          className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-[0.06em] text-ink-muted"
        >
          {t(`palette.groups.${c.group}`)}
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
        aria-label={t("palette.label")}
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
            aria-label={t("palette.inputLabel")}
            placeholder={t("shell.searchOrRun")}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 border-0 bg-transparent text-section text-ink outline-none placeholder:text-ink-muted/70 focus-visible:outline-none"
          />
          <kbd className="rounded border border-b-2 border-border bg-surface-raised px-[5px] font-mono text-xs">Esc</kbd>
        </div>
        <ul ref={listRef} id={listId} role="listbox" className="max-h-[min(380px,50vh)] overflow-auto p-1.5">
          {items.length ? (
            rows
          ) : (
            <li role="presentation" className="p-5 text-center text-sm text-ink-muted">
              {t("palette.noMatches")}
            </li>
          )}
        </ul>
        <div className="flex gap-4 border-t border-border px-3.5 py-2 text-xs text-ink-muted">
          <span>{t("palette.move")}</span>
          <span>{t("palette.open")}</span>
          <span>{t("palette.close")}</span>
        </div>
      </div>
    </div>
  );
}
