"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Eye, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { Stepper } from "@/components/ui/Stepper";
import { HeaderBlock } from "@/components/ui/PageHeader";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { PAGE_WITH_BAR, SAVE_BAR } from "@/components/editor/save-bar";

export type EditorMode = "dock" | "drawer" | "page";

/** How a page-mode editor moves between its sections (DESIGN.md §7):
 * `rail` scrolls one long page; `tabs` shows one group at a time (editing);
 * `steps` is the creating wizard. */
/** `plain`: one stacked page with no rail and no jump bar (demo H workspace settings). */
export type EditorNavKind = "rail" | "tabs" | "steps" | "plain";

/** A tab or a wizard step: a group of sections shown together. */
export interface EditorGroupDef {
  id: string;
  label: string;
  /** The section ids it shows. */
  sections: string[];
  /** Steps: the question heading ("What is it?") and its lead line. */
  question?: string;
  lead?: ReactNode;
}

interface EditorNav {
  /** Whether a section is in the tab or step on show. */
  visible: (sectionId: string) => boolean;
  /** Whether a section is alone in its tab or step (its heading would only
   * repeat the tab label or the step's question). */
  alone: (sectionId: string) => boolean;
  /** Show a tab or step (Review's "Change" links). */
  goTo: (groupId: string) => void;
}

const EditorNavContext = createContext<EditorNav | null>(null);

/** A page editor with one section and no tabs or steps: the title says it all. */
const SoleSectionContext = createContext(false);
/** A full page: its title is the h1, so section headings are h2 (drawers: h3). */
const PageModeContext = createContext(false);

/** The tab / step controls of the enclosing editor, or null for a rail. */
export function useEditorNav(): EditorNav | null {
  return useContext(EditorNavContext);
}

/** Inputs inside hidden tabs and steps don't count when moving focus. */
function shownInvalid(root: HTMLElement | null): HTMLElement[] {
  return Array.from(root?.querySelectorAll<HTMLElement>('[aria-invalid="true"]') ?? []).filter(
    (el) => el.getClientRects().length > 0,
  );
}

/** A hairline above every shown section that follows another shown one. */
const SECTION_RULES =
  "[&_section[data-editor-section]:not([hidden])~section[data-editor-section]:not([hidden])]:border-t [&_section[data-editor-section]:not([hidden])~section[data-editor-section]:not([hidden])]:border-border-soft [&_section[data-editor-section]:not([hidden])~section[data-editor-section]:not([hidden])]:pt-7";

const nextFrame = (fn: () => void) => window.requestAnimationFrame(() => window.requestAnimationFrame(fn));

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
  /** Replaces the read-only banner's text; `false` hides it. */
  readOnlyNote?: ReactNode | false;
  saveLabel?: string;
  /** Runs the save; resolve `false` when validation stopped it. */
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
  /** Creating: the bar's Cancel (always enabled). Defaults to going back. */
  onCancel?: () => void;
  onClose?: () => void;
  menu?: DropdownMenuItem[][];
  /** Extra header buttons (e.g. Duplicate). */
  headerActions?: ReactNode;
  /** Page mode inside another page (a record page's Settings tab): no title
   * block, menu or rail — the host page has them; fields and save bar only. */
  headless?: boolean;
  /** Page mode: rail (default), tabs or steps; `groups` says which sections
   * each tab or step shows. */
  nav?: EditorNavKind;
  groups?: EditorGroupDef[];
  /** The query parameter that holds the open tab. Default `tab`. */
  tabParam?: string;
  /** Steps: reveals these fields' errors (the record editor's `touchAll`),
   * so Next can mark what stops the step. */
  onTouch?: (paths: string[]) => void;
  /** Steps: shown on the first step, above its question (Add device's
   * "how to start" cards). */
  intro?: ReactNode;
  children: ReactNode;
}

/** One section of an editor body (target of the jump bar / rail). */
export function EditorSection({
  id,
  title,
  lead,
  actions,
  tone,
  children,
}: {
  id: string;
  /** Omitted, or hidden when the section is alone on its page, tab or step. */
  title?: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  /** "danger": the red heading of a danger section, always last (DESIGN.md
   * §7: only on a page with no record menu, e.g. Leave workspace). */
  tone?: "danger";
  children: ReactNode;
}) {
  const nav = useEditorNav();
  const sole = useContext(SoleSectionContext);
  const HeadingTag = useContext(PageModeContext) ? "h2" : "h3";
  // DESIGN.md §7: a heading never repeats the page title, the tab label or the
  // step's question, so a section alone on its page, tab or step has none.
  const heading = title != null && !sole && !nav?.alone(id) ? title : null;
  return (
    <section
      id={`ps-${id}`}
      data-editor-section={id}
      // Kept mounted while another tab or step shows, so its fields still
      // validate and keep their state.
      hidden={nav ? !nav.visible(id) : undefined}
      className="flex scroll-mt-6 flex-col gap-3"
    >
      {(heading != null || actions) && (
        <div className="flex items-baseline justify-between gap-3">
          {heading != null && <HeadingTag className={cn("text-section font-semibold tracking-[-0.01em]", tone === "danger" ? "text-status-error" : "text-ink")}>{heading}</HeadingTag>}
          {actions}
        </div>
      )}
      {lead && <p className={cn("max-w-[64ch] text-meta text-ink-muted", heading != null && "-mt-1.5")}>{lead}</p>}
      {children}
    </section>
  );
}

/**
 * DESIGN.md §7 — the one editor chrome, in three presentations: docked beside
 * its list, a drawer, or a full page. A full page moves between its sections
 * with the section rail (≥ 1200px), with **tabs** (editing: one group of
 * sections at a time, `?tab=`), or with **steps** (creating: a wizard whose
 * Next refuses while its step has problems, ending in Review). Shared:
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
  readOnlyNote,
  saveLabel,
  onSave,
  onDiscard,
  onCancel,
  onClose,
  menu,
  headerActions,
  headless = false,
  nav: navKind = "rail",
  groups,
  tabParam = "tab",
  onTouch,
  intro,
  children,
}: EditorFrameProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const toast = useToast();
  const [current, setCurrent] = useState(sections[0]?.id ?? "");
  const scrolls = mode !== "page"; // dock/drawer scroll their body; a page scrolls the window
  const groupList = groups ?? [];
  const grouped = mode === "page" && navKind !== "rail" && groupList.length > 0;
  const tabs = grouped && navKind === "tabs";
  const steps = grouped && navKind === "steps";

  // The open tab lives in the URL (DESIGN.md §5); a wizard's step does not.
  const [group, setGroup] = useState(() => {
    if (tabs && typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get(tabParam);
      if (t && groups?.some((g) => g.id === t)) return t;
    }
    return groups?.[0]?.id ?? "";
  });
  const activeGroup = groups?.find((g) => g.id === group) ?? groups?.[0];
  const stepIndex = groups && activeGroup ? groups.indexOf(activeGroup) : 0;

  const goTo = useCallback(
    (id: string) => {
      setGroup(id);
      if (!tabs) return;
      const url = new URL(window.location.href);
      if (id === groups?.[0]?.id) url.searchParams.delete(tabParam);
      else url.searchParams.set(tabParam, id);
      window.history.replaceState(window.history.state, "", url);
    },
    [tabs, groups, tabParam],
  );

  const navValue = useMemo<EditorNav | null>(
    () =>
      grouped && activeGroup
        ? {
            visible: (id) => activeGroup.sections.includes(id),
            alone: (id) => groups?.find((g) => g.sections.includes(id))?.sections.length === 1,
            goTo,
          }
        : null,
    [grouped, activeGroup, goTo, groups],
  );

  // A new step moves focus to its question. Only on a real change of step:
  // a flag for "first render" is spent by StrictMode's double effect run, and
  // the second run would steal focus from an autofocused field (blurring it
  // shows its error before anything was typed).
  const shownStep = useRef(group);
  useEffect(() => {
    if (!steps || shownStep.current === group) return;
    shownStep.current = group;
    window.scrollTo({ top: 0 });
    questionRef.current?.focus();
  }, [steps, group]);

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

  // A link to a section (e.g. /templates/{id}#hardware) lands on it, once.
  // With tabs or steps, it opens the group that holds the section first.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const holder = groupList.find((g) => g.sections.includes(id));
    if (grouped && holder) goTo(holder.id);
    if (rootRef.current?.querySelector(`#ps-${CSS.escape(id)}`)) nextFrame(() => jumpTo(id));
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Focus the next invalid field after the focused one (wraps). */
  const focusNextError = useCallback(() => {
    const fields = shownInvalid(bodyRef.current);
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
      // Tabs and steps: open the first one with a problem.
      if (grouped) {
        const paths = Object.keys(status.errors);
        const first = groups?.find((g) => paths.some((p) => g.sections.includes(sectionOf(p))));
        if (first) goTo(first.id);
      }
      // Errors render on the next frame; then move to the first one.
      nextFrame(() => {
        const n = shownInvalid(bodyRef.current).length;
        focusNextError();
        if (n > 0) {
          toast({
            tone: "error",
            title: `${n} field${n === 1 ? " needs" : "s need"} attention`,
            detail: "Moved you to the first one. The red count in the save bar takes you to the next.",
          });
        }
      });
    }
  }, [readOnly, status.dirty, status.saving, status.errors, onSave, focusNextError, toast, grouped, groups, sectionOf, goTo]);

  /** Steps: Next refuses while this step has problems, and marks them. */
  const nextStep = useCallback(() => {
    if (!groups || !activeGroup) return;
    const paths = Object.keys(status.errors).filter((p) => activeGroup.sections.includes(sectionOf(p)));
    if (paths.length > 0) {
      onTouch?.(paths);
      nextFrame(() => {
        const first = shownInvalid(bodyRef.current)[0];
        if (first) {
          first.scrollIntoView({ block: "center", behavior: "smooth" });
          first.focus({ preventScroll: true });
        } else {
          toast({ tone: "error", title: "Fix the marked items first" });
        }
      });
      return;
    }
    const next = groups[stepIndex + 1];
    if (next) goTo(next.id);
  }, [groups, activeGroup, status.errors, sectionOf, onTouch, toast, stepIndex, goTo]);

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

  // DESIGN.md §7: creating always shows the bar (it holds Create / Next);
  // editing shows it only while there is an edit, a save or a problem.
  const showFoot = !readOnly && (steps || status.isNew || status.dirty || status.saving || issues > 0);

  // A full-page save bar sits at the viewport bottom; lift toasts above it.
  useEffect(() => {
    if (mode !== "page" || !showFoot) return;
    document.documentElement.dataset.savebar = "1";
    return () => {
      delete document.documentElement.dataset.savebar;
    };
  }, [mode, showFoot]);

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

  // Creating says one thing whatever has been typed (DESIGN.md §7); "Unsaved
  // changes" is for editing a record that exists.
  const stateText = status.saving ? (
    "Saving…"
  ) : readOnly ? null : status.isNew ? (
    "Not created yet"
  ) : status.dirty ? (
    <>
      <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-status-pending" />
      Unsaved changes
    </>
  ) : (
    <>
      <Check aria-hidden size={14} className="mr-1 inline text-status-online" />
      All changes saved
    </>
  );

  const showRail = mode === "page" && !headless && !grouped && navKind !== "plain" && sections.length > 1;
  const showJump = !headless && !grouped && navKind !== "plain" && sections.length > 1;
  const groupIssues = (g: EditorGroupDef) => status.visibleErrors.filter((p) => g.sections.includes(sectionOf(p))).length;

  const tabStrip = tabs && (
    <Tabs
      ariaLabel={`${noun.charAt(0).toUpperCase()}${noun.slice(1)} sections`}
      tabs={groupList.map((g) => ({ id: g.id, label: g.label, issues: groupIssues(g) }))}
      active={activeGroup?.id ?? ""}
      onChange={goTo}
      className="mb-2"
    />
  );

  const stepper = steps && (
    <Stepper steps={groupList.map((g) => ({ id: g.id, label: g.label, issues: groupIssues(g) }))} current={stepIndex} />
  );

  const question = steps && activeGroup?.question && (
    <div className="flex flex-col gap-1">
      <h2 ref={questionRef} tabIndex={-1} className="text-section font-semibold tracking-[-0.01em] text-ink outline-none">
        {activeGroup.question}
      </h2>
      {activeGroup.lead && <p className="text-ink-muted">{activeGroup.lead}</p>}
    </div>
  );

  const TitleTag = mode === "page" ? "h1" : "h2";
  const closeButton = onClose && (
    <IconButton aria-label={`Close ${noun} editor`} onClick={onClose}>
      <X size={18} />
    </IconButton>
  );
  const head = headless ? null : mode === "page" ? (
    // A full page shares the page header's anatomy (DESIGN.md §4).
    <div className="shrink-0 pb-3.5 [grid-area:head]">
      <HeaderBlock
        overline={eyebrow}
        menuOnly={!headerActions && !closeButton && !!menu?.length}
        heading={
          <h1 tabIndex={-1} className="break-words text-title font-semibold leading-[1.2] tracking-[-0.015em] text-ink outline-none">
            {title}
          </h1>
        }
        actions={
          (headerActions || (menu && menu.length > 0) || closeButton) && (
            <>
              {headerActions}
              {menu && menu.length > 0 && <DropdownMenu groups={menu} label="More actions" />}
              {closeButton}
            </>
          )
        }
      >
        {consequence && <p className="mt-1 max-w-[70ch] text-sm text-ink-muted">{consequence}</p>}
      </HeaderBlock>
    </div>
  ) : (
    <div className="flex shrink-0 items-start gap-2.5 border-b border-border px-5 pb-3 pt-4 max-md:flex-col max-md:items-stretch">
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        {eyebrow && <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">{eyebrow}</div>}
        {/* A drawer's title is a section heading; a full page's is its H1 (above). */}
        <TitleTag tabIndex={-1} className="break-words text-section font-semibold leading-[1.3] tracking-[-0.015em] text-ink outline-none">
          {title}
        </TitleTag>
        {consequence && <p className="mt-1 max-w-[70ch] text-xs text-ink-muted">{consequence}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1 max-md:order-first max-md:justify-end">
        {headerActions}
        {menu && menu.length > 0 && <DropdownMenu groups={menu} label="More actions" />}
        {closeButton}
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
              "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-[11px] text-meta",
              on ? "bg-accent-muted font-medium text-accent-strong" : "text-ink-muted hover:bg-surface-raised hover:text-ink",
            )}
          >
            {s.label}
            {s.count != null && <span className="text-xs text-ink-muted">{s.count}</span>}
            {e > 0 && (
              <span aria-label={`${e} to fix`} className="grid h-[17px] min-w-[17px] place-items-center rounded-full bg-status-error px-[5px] text-xs font-bold text-on-accent">
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
                  {s.description && <small className="text-xs text-ink-muted">{s.description}</small>}
                </span>
                {shown > 0 && (
                  <span aria-label={`${shown} to fix`} className="mt-px grid h-[18px] min-w-[18px] place-items-center rounded-full bg-status-error px-[5px] text-xs font-bold text-on-accent">
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
      // With tabs, the body is the active tab's panel (WAI-ARIA tabs).
      {...(tabs && activeGroup ? { role: "tabpanel", id: `tabpanel-${activeGroup.id}`, "aria-labelledby": `tab-${activeGroup.id}` } : {})}
      className={cn(
        // @container: editor bodies lay out by their own width (dock vs page).
        "@container flex flex-col",
        // DESIGN.md §4/§7: one 760px column; sections divided by hairlines.
        mode === "page" && SECTION_RULES,
        headless
          ? "max-w-[760px] gap-7 pb-4"
          : grouped
            ? "max-w-[760px] gap-7 py-5"
            : mode === "page"
              ? "max-w-[760px] gap-7 py-6 [grid-area:body] wb:pt-2"
              : "min-h-0 flex-1 gap-7 overflow-auto px-5 pb-8 pt-5",
      )}
    >
      {steps && stepIndex === 0 && intro}
      {question}
      {readOnly && readOnlyNote !== false && (
        <p className="flex items-center gap-2 rounded-md bg-accent-muted px-3.5 py-2.5 text-meta text-accent-strong">
          <Eye aria-hidden size={15} />
          {readOnlyNote ?? "View only. Ask an admin to make changes."}
        </p>
      )}
      {children}
    </div>
  );

  const cancel = () => (onCancel ? onCancel() : window.history.back());

  const foot = showFoot && (
    <div
      data-savebar={mode === "page" || undefined}
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-2.5 border-t border-border",
        mode === "page"
          ? // An edit's bar slides up when the first change is made.
            cn(SAVE_BAR, "[grid-area:foot]", !steps && !status.isNew && "motion-safe:animate-[toastin_.15s_ease-out]")
          : "bg-surface px-5 py-3",
      )}
    >
      <div className="flex min-w-[150px] flex-1 items-center gap-2.5 text-meta text-ink-muted">
        <span aria-live="polite" className="inline-flex items-center">
          {stateText}
        </span>
        {issues > 0 && (
          <button
            type="button"
            onClick={focusNextError}
            className="inline-flex h-7 items-center gap-[5px] rounded-full bg-status-error-surface px-2.5 text-xs font-semibold text-status-error"
          >
            <AlertCircle aria-hidden size={13} />
            {issues} to fix
          </button>
        )}
      </div>
      {steps ? (
        // The wizard (DESIGN.md §5): Back, then Next: {step}, and on the
        // last step the button that names the result.
        <div className="flex items-center gap-2">
          {stepIndex > 0 ? (
            <Button variant="ghost" onClick={() => goTo(groupList[stepIndex - 1].id)}>
              <ChevronLeft aria-hidden size={15} />
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          )}
          {stepIndex < groupList.length - 1 ? (
            <Button onClick={nextStep}>
              Next: {groupList[stepIndex + 1].label}
              <ChevronRight aria-hidden size={15} />
            </Button>
          ) : (
            <Button disabled={!status.dirty || status.saving} onClick={() => void save()}>
              {status.saving ? "Saving…" : (saveLabel ?? `Create ${noun}`)}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {/* DESIGN.md §7: creating offers Cancel (always a way back);
              editing offers Discard. */}
          {status.isNew ? (
            <Button variant="ghost" disabled={status.saving} onClick={cancel}>
              Cancel
            </Button>
          ) : (
            <Button variant="ghost" disabled={!status.dirty || status.saving} onClick={onDiscard}>
              Discard
            </Button>
          )}
          <Button disabled={!status.dirty || status.saving} onClick={() => void save()}>
            {status.saving ? "Saving…" : (saveLabel ?? (status.isNew ? `Create ${noun}` : "Save"))}
          </Button>
        </div>
      )}
    </div>
  );

  const sole = !grouped && sections.length === 1;

  const frame =
    mode === "page" ? (
      <EditorNavContext.Provider value={navValue}>
        <div
          ref={rootRef}
          className={cn(
            "flex flex-col",
            grouped && "@container",
            headless ? "flex-1" : PAGE_WITH_BAR,
            showRail && "wb:grid wb:grid-cols-[230px_minmax(0,1fr)] wb:grid-rows-[auto_1fr_auto] wb:items-start wb:gap-x-9 wb:[grid-template-areas:'head_head''rail_body''foot_foot']",
          )}
        >
          {head}
          {jump}
          {rail}
          {tabStrip}
          {stepper}
          {body}
          {foot}
        </div>
      </EditorNavContext.Provider>
    ) : (
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

  return (
    <PageModeContext.Provider value={mode === "page"}>
      <SoleSectionContext.Provider value={sole}>{frame}</SoleSectionContext.Provider>
    </PageModeContext.Provider>
  );
}
