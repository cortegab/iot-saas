"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, Check, Eye, Maximize2, PanelRight, X } from "lucide-react";
import { Button, IconButton, buttonClassName } from "@/components/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

export type EditorMode = "dock" | "drawer" | "page";

export interface EditorSectionDef {
  id: string;
  label: string;
  /** Count beside the label (e.g. number of metrics). */
  count?: number;
  /** One line under the label in the page rail. */
  description?: string;
}

/** The subset of `RecordEditor` the frame reads. */
export interface EditorStatus {
  dirty: boolean;
  saving: boolean;
  isNew: boolean;
  errors: Record<string, string>;
  visibleErrors: string[];
}

export interface EditorFrameProps {
  mode: EditorMode;
  /** Record kind in words ("device", "device template"). */
  noun: string;
  title: string;
  /** Small line above the title — kind + status pill. */
  eyebrow?: ReactNode;
  /** What saving does (DESIGN.md §7 consequence line). */
  consequence?: ReactNode;
  sections: EditorSectionDef[];
  /** Which section a field path belongs to; default: first path segment. */
  sectionOf?: (path: string) => string;
  status: EditorStatus;
  readOnly?: boolean;
  saveLabel?: string;
  /** Runs the save; resolve `false` when validation stopped it. */
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
  onClose?: () => void;
  /** Dock/drawer: link to the full page. Page: link back beside the list. */
  expandHref?: string;
  dockHref?: string;
  menu?: DropdownMenuItem[][];
  /** Extra header buttons (e.g. Duplicate). */
  headerActions?: ReactNode;
  children: ReactNode;
}

/** One section of an editor body (target of the jump bar / rail). */
export function EditorSection({
  id,
  title,
  lead,
  actions,
  children,
}: {
  id: string;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={`ps-${id}`} data-editor-section={id} className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        {actions}
      </div>
      {lead && <p className="-mt-1.5 max-w-[64ch] text-[13.5px] text-ink-muted">{lead}</p>}
      {children}
    </section>
  );
}

/**
 * DESIGN.md §7 — the one editor chrome, in three presentations: docked beside
 * its list, a drawer, or a full page (with the section rail ≥ 1200px). Shared:
 * title + record menu, consequence line, section jump with per-section error
 * badges, a sticky save bar ("Unsaved changes" / "All changes saved", Discard,
 * Save, "N to fix"), Ctrl+S, and a read-only mode with a banner and no save bar.
 */
export function EditorFrame({
  mode,
  noun,
  title,
  eyebrow,
  consequence,
  sections,
  sectionOf = (p) => p.split(".")[0],
  status,
  readOnly = false,
  saveLabel,
  onSave,
  onDiscard,
  onClose,
  expandHref,
  dockHref,
  menu,
  headerActions,
  children,
}: EditorFrameProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [current, setCurrent] = useState(sections[0]?.id ?? "");
  const scrolls = mode !== "page"; // dock/drawer scroll their body; a page scrolls the window

  const shownBySection = new Map<string, number>();
  for (const p of status.visibleErrors) shownBySection.set(sectionOf(p), (shownBySection.get(sectionOf(p)) ?? 0) + 1);
  const allBySection = new Map<string, number>();
  for (const p of Object.keys(status.errors)) allBySection.set(sectionOf(p), (allBySection.get(sectionOf(p)) ?? 0) + 1);
  const issues = status.visibleErrors.length;

  // Scroll-spy: the current section is the last one whose top has passed the
  // top of the scroll area.
  useEffect(() => {
    const root = scrolls ? bodyRef.current : null;
    const container = rootRef.current;
    if (!container) return;
    function update() {
      const els = Array.from(container!.querySelectorAll<HTMLElement>("[data-editor-section]"));
      const top = (root ? root.getBoundingClientRect().top : 0) + (root ? 48 : 160);
      let cur = els[0]?.dataset.editorSection ?? "";
      for (const el of els) if (el.getBoundingClientRect().top <= top) cur = el.dataset.editorSection ?? cur;
      setCurrent(cur);
    }
    const target: HTMLElement | Window = root ?? window;
    target.addEventListener("scroll", update, { passive: true });
    update();
    return () => target.removeEventListener("scroll", update);
  }, [scrolls]);

  const jumpTo = useCallback((id: string) => {
    setCurrent(id);
    rootRef.current?.querySelector(`#ps-${CSS.escape(id)}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  /** Focus the next invalid field after the focused one (wraps). */
  const focusNextError = useCallback(() => {
    const fields = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('[aria-invalid="true"]') ?? []);
    if (fields.length === 0) return;
    const i = fields.indexOf(document.activeElement as HTMLElement);
    const next = fields[(i + 1) % fields.length];
    next.scrollIntoView({ block: "center", behavior: "smooth" });
    next.focus({ preventScroll: true });
  }, []);

  const save = useCallback(async () => {
    if (readOnly || !status.dirty || status.saving) return;
    const ok = await onSave();
    if (!ok) {
      // Errors render on the next frame; then move to the first one.
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          const n = bodyRef.current?.querySelectorAll('[aria-invalid="true"]').length ?? 0;
          focusNextError();
          if (n > 0) {
            toast({
              tone: "error",
              title: `${n} field${n === 1 ? " needs" : "s need"} attention`,
              detail: "Moved you to the first one. The red count in the save bar takes you to the next.",
            });
          }
        }),
      );
    }
  }, [readOnly, status.dirty, status.saving, onSave, focusNextError, toast]);

  // Ctrl/⌘+S saves while the editor is mounted.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!document.querySelector('[role="alertdialog"]')) void save();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [save]);

  // A full-page save bar sits at the viewport bottom; lift toasts above it.
  useEffect(() => {
    if (mode !== "page" || readOnly) return;
    document.documentElement.dataset.savebar = "1";
    return () => {
      delete document.documentElement.dataset.savebar;
    };
  }, [mode, readOnly]);

  // Esc closes a docked editor while focus is inside it (the Sheet handles the drawer).
  useEffect(() => {
    if (mode !== "dock" || !onClose) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || !rootRef.current?.contains(document.activeElement)) return;
      if (document.querySelector('[role="alertdialog"], [role="menu"], [role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      onClose?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const stateText = status.saving ? (
    "Saving…"
  ) : readOnly ? null : status.dirty ? (
    <>
      <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-status-pending" />
      Unsaved changes
    </>
  ) : status.isNew ? (
    `New ${noun}, not created yet`
  ) : (
    <>
      <Check aria-hidden size={14} className="mr-1 inline text-status-online" />
      All changes saved
    </>
  );

  const showRail = mode === "page" && sections.length > 1;
  const showJump = sections.length > 1;

  const head = (
    <div
      className={cn(
        "flex shrink-0 items-start gap-2.5 max-md:flex-col max-md:items-stretch",
        mode === "page" ? "pb-3.5 [grid-area:head]" : "border-b border-border px-5 pb-3 pt-4",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        {eyebrow && <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">{eyebrow}</div>}
        <h2
          tabIndex={-1}
          className={cn(
            "break-words font-semibold text-ink outline-none",
            mode === "page" ? "text-[24px] leading-[1.15] tracking-[-0.025em] md:text-[30px]" : "text-[19px] leading-[1.3] tracking-[-0.015em]",
          )}
        >
          {title}
        </h2>
        {consequence && (
          <p className={cn("mt-1 max-w-[70ch] text-ink-muted", mode === "page" ? "text-[14.5px]" : "text-[12.5px]")}>
            {consequence}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 max-md:order-first max-md:justify-end">
        {headerActions}
        {menu && menu.length > 0 && <DropdownMenu groups={menu} label="More actions" />}
        {mode !== "page" && expandHref && (
          <Link
            href={expandHref}
            aria-label="Expand to full page"
            title="Expand to full page"
            className="hidden h-[30px] w-[30px] place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink shell:inline-grid"
          >
            <Maximize2 aria-hidden size={16} />
          </Link>
        )}
        {mode === "page" && dockHref && (
          <Link href={dockHref} className={cn(buttonClassName({ variant: "secondary", size: "sm" }), "hidden shell:inline-flex")}>
            <PanelRight aria-hidden size={14} />
            Show beside list
          </Link>
        )}
        {onClose && (
          <IconButton aria-label={`Close ${noun} editor`} onClick={onClose}>
            <X size={18} />
          </IconButton>
        )}
      </div>
    </div>
  );

  const jump = showJump && (
    <nav
      aria-label="Sections"
      className={cn(
        "flex shrink-0 gap-1 overflow-x-auto [scrollbar-width:none]",
        mode === "page"
          ? "sticky top-0 z-[4] -mx-1 border-b border-border bg-canvas px-1 py-2 wb:hidden"
          : "border-b border-border bg-surface px-3.5 py-2",
      )}
    >
      {sections.map((s) => {
        const e = shownBySection.get(s.id) ?? 0;
        const on = current === s.id;
        return (
          <button
            key={s.id}
            type="button"
            aria-current={on || undefined}
            onClick={() => jumpTo(s.id)}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-[11px] text-[13px]",
              on ? "bg-accent-muted font-medium text-accent-strong" : "text-ink-muted hover:bg-surface-raised hover:text-ink",
            )}
          >
            {s.label}
            {s.count != null && <span className="text-xs text-ink-muted">{s.count}</span>}
            {e > 0 && (
              <span aria-label={`${e} to fix`} className="grid h-[17px] min-w-[17px] place-items-center rounded-full bg-status-error px-[5px] text-[10.5px] font-bold text-on-accent">
                {e}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );

  const rail = showRail && (
    <aside aria-label="Sections" className="hidden [grid-area:rail] wb:sticky wb:top-4 wb:flex wb:flex-col wb:gap-1.5 wb:pt-2">
      <p className="px-2.5 pb-1 text-xs font-semibold text-ink-muted">{status.isNew ? `New ${noun}` : "Sections"}</p>
      <ol className="flex flex-col gap-0.5">
        {sections.map((s, i) => {
          const shown = shownBySection.get(s.id) ?? 0;
          const all = allBySection.get(s.id) ?? 0;
          const on = current === s.id;
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-current={on || undefined}
                onClick={() => jumpTo(s.id)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-md p-2.5 text-left",
                  on ? "bg-surface shadow-[0_0_0_1px_var(--color-border),var(--shadow-card)]" : "hover:bg-surface-raised",
                )}
              >
                {status.isNew && (
                  <span
                    aria-hidden
                    className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded-full border-[1.5px] text-xs font-semibold",
                      all === 0
                        ? "border-status-online bg-status-online text-on-accent"
                        : on
                          ? "border-accent bg-surface text-accent"
                          : "border-border bg-surface text-ink-muted",
                    )}
                  >
                    {all === 0 ? "✓" : i + 1}
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <strong className={cn("text-sm font-medium", on && "text-accent-strong")}>
                    {s.label}
                    {s.count != null && <span className="ml-1 text-xs font-normal text-ink-muted">{s.count}</span>}
                  </strong>
                  {s.description && <small className="text-[12.5px] text-ink-muted">{s.description}</small>}
                </span>
                {shown > 0 && (
                  <span aria-label={`${shown} to fix`} className="mt-px grid h-[18px] min-w-[18px] place-items-center rounded-full bg-status-error px-[5px] text-[11px] font-bold text-on-accent">
                    {shown}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {status.isNew && <p className="px-2.5 py-1.5 text-xs text-ink-muted">A step shows ✓ once it has no errors. Save checks everything again.</p>}
    </aside>
  );

  const body = (
    <div
      ref={bodyRef}
      className={cn(
        // @container: editor bodies lay out by their own width (dock vs page).
        "@container flex flex-col gap-7",
        mode === "page" ? "max-w-[980px] py-6 [grid-area:body] wb:pt-2" : "min-h-0 flex-1 overflow-auto px-5 pb-8 pt-5",
      )}
    >
      {readOnly && (
        <p className="flex items-center gap-2 rounded-md bg-accent-muted px-3.5 py-2.5 text-[13.5px] text-accent-strong">
          <Eye aria-hidden size={15} />
          View only. Ask an admin to make changes.
        </p>
      )}
      {children}
    </div>
  );

  const foot = !readOnly && (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-2.5 border-t border-border",
        mode === "page"
          ? "sticky bottom-0 z-[6] -mx-4 bg-surface/92 px-4 pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur-[10px] [grid-area:foot] md:-mx-10 md:px-10"
          : "bg-surface px-5 py-3",
      )}
    >
      <div className="flex min-w-[150px] flex-1 items-center gap-2.5 text-[13px] text-ink-muted">
        <span aria-live="polite" className="inline-flex items-center">
          {stateText}
        </span>
        {issues > 0 && (
          <button
            type="button"
            onClick={focusNextError}
            className="inline-flex h-7 items-center gap-[5px] rounded-full bg-status-error-surface px-2.5 text-[12.5px] font-semibold text-status-error"
          >
            <AlertCircle aria-hidden size={13} />
            {issues} to fix
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" disabled={!status.dirty || status.saving} onClick={onDiscard}>
          Discard
        </Button>
        <Button disabled={!status.dirty || status.saving} onClick={() => void save()}>
          {status.saving ? "Saving…" : (saveLabel ?? (status.isNew ? `Create ${noun}` : "Save"))}
        </Button>
      </div>
    </div>
  );

  if (mode === "page") {
    return (
      <div
        ref={rootRef}
        className={cn(
          "-mb-[110px] flex flex-col",
          showRail && "wb:grid wb:grid-cols-[230px_minmax(0,1fr)] wb:items-start wb:gap-x-9 wb:[grid-template-areas:'head_head''rail_body''foot_foot']",
        )}
      >
        {head}
        {jump}
        {rail}
        {body}
        {foot}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      role={mode === "dock" ? "region" : undefined}
      aria-label={mode === "dock" ? `${title} editor` : undefined}
      className={cn(
        "flex min-w-0 flex-col bg-surface [container-type:inline-size]",
        mode === "dock"
          ? "sticky top-4 h-[calc(100vh-32px)] overflow-hidden rounded-2xl border border-border shadow-pop motion-safe:animate-[panein_.18s_ease-out]"
          : "h-full",
      )}
    >
      {head}
      {jump}
      {body}
      {foot}
    </div>
  );
}
