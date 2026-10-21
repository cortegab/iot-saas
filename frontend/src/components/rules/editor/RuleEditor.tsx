"use client";

/**
 * Create/edit a rule in one of two equivalent views over the same RuleDraft:
 * Form (conditions and actions as rows that open sheets) and Ladder (a
 * PLC-style rung). Switching is lossless — both edit the draft through the
 * same `rule-draft` operations.
 *
 * DESIGN.md §9.2 (demo H): Name and Status, then the editable sentence, then
 * tabs When · If · Then · Behaviour (· Activity on a saved rule), kept in
 * `?tab=`. Form / Ladder switches inside If and Then. The preview sits beside
 * the editor when the content is at least 1160px wide, and behind a Preview
 * button otherwise. One sticky save bar.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Activity, AlertCircle, AlertTriangle, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Badge";
import { SwitchField } from "@/components/ui/Switch";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { ItemSheet } from "@/components/ui/ItemSheet";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Stepper } from "@/components/ui/Stepper";
import { Tabs } from "@/components/ui/Tabs";
import { ApiRequestError } from "@/lib/api-client";
import { contacts, draftFromRule, draftToRequest, emptyDraft, validateDraft, type RuleDraft } from "@/lib/rule-draft";
import { MAX_NAME, sectionIssues, type RuleSection } from "@/lib/rule-preview";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { EditableSentence } from "./EditableSentence";
import { LadderCanvas, LadderInspector, liveSelection, type EditorSelection } from "@/components/rules/ladder/LadderMode";
import type { components } from "@/types/api";
import { BehaviourSection, ConditionSection, ThenSection, WhenSection } from "./FormMode";
import { RulePreview } from "./RulePreview";
import { useRuleCatalog } from "./useRuleCatalog";

type RuleResponse = components["schemas"]["RuleResponse"];
type RuleVersionResponse = components["schemas"]["RuleVersionResponse"];
type EditorMode = "form" | "ladder";
type RuleTab = "when" | "if" | "then" | "behaviour" | "activity" | "review";

const MODE_KEY = "rule-editor-mode";
const TAB_LABEL: Record<RuleTab, string> = {
  when: "When",
  if: "If",
  then: "Then",
  behaviour: "Behaviour",
  activity: "Activity",
  review: "Review",
};
// A new rule is a wizard (DESIGN.md §9.1): one question per step.
const WIZARD: RuleTab[] = ["when", "if", "then", "behaviour", "review"];
const QUESTION: Partial<Record<RuleTab, [string, string]>> = {
  when: ["What starts it?", "A reading, a schedule, a person, or a device going online or offline."],
  if: ["What has to be true?", "Add conditions. Combine them with All (and) or Any (or)."],
  then: ["What should happen?", "Switch something, send an email, call a webhook or post a notification."],
  behaviour: ["How should it behave?", "Re-arm or latch, and the safety timers that stop hardware flapping."],
  review: ["Check and create", "Name it, see what it would have done, and create it."],
};
// The rule page's older tab names (Logic / Activity, before them Simulate / Versions).
const OLD_TABS: Record<string, RuleTab> = { edit: "if", simulate: "if", versions: "activity" };

function readMode(): EditorMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "ladder" ? "ladder" : "form";
  } catch {
    return "form";
  }
}

function writeMode(mode: EditorMode) {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private mode / blocked storage — the choice just isn't remembered.
  }
}

export function RuleEditor({
  deviceId,
  existing,
  initialDraft,
  onSaved,
  onCancel,
  activity,
}: {
  /** Seeds the first condition and action device for a new rule. */
  deviceId?: string;
  existing?: RuleResponse;
  /** A new rule's starting point (a recipe), or a version restored over an
   * existing rule; blank / the saved rule otherwise. */
  initialDraft?: RuleDraft;
  onSaved: (saved: RuleResponse) => void;
  /** A new rule's way back (e.g. to the recipes). */
  onCancel?: () => void;
  /** A saved rule's Activity tab: recent firings, then Versions. */
  activity?: ReactNode;
}) {
  const api = useApi();
  const catalog = useRuleCatalog();
  // The baseline is what's saved; a restored version (initialDraft over an
  // existing rule) starts as unsaved changes against it.
  const [baseline, setBaseline] = useState<RuleDraft>(() => (existing ? draftFromRule(existing) : (initialDraft ?? emptyDraft(deviceId ?? ""))));
  const [draft, setDraft] = useState<RuleDraft>(() => (existing && initialDraft ? initialDraft : baseline));
  const [mode, setMode] = useState<EditorMode>("form");
  const [selection, setSelection] = useState<EditorSelection>({ kind: "when" });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const isNew = !existing;
  const nameRef = useRef<HTMLInputElement>(null);

  const wizard = isNew;
  const tabs: RuleTab[] = wizard ? WIZARD : activity ? ["when", "if", "then", "behaviour", "activity"] : ["when", "if", "then", "behaviour"];
  const defaultTab: RuleTab = isNew ? "when" : "if";
  const [tab, setTabState] = useState<RuleTab>(() => {
    if (typeof window === "undefined" || wizard) return defaultTab;
    const raw = new URLSearchParams(window.location.search).get("tab") ?? "";
    const t = (OLD_TABS[raw] ?? raw) as RuleTab;
    return tabs.includes(t) ? t : defaultTab;
  });
  const questionRef = useRef<HTMLHeadingElement>(null);
  const stepIndex = Math.max(0, tabs.indexOf(tab));
  const setTab = useCallback(
    (next: RuleTab) => {
      setTabState(next);
      // A wizard's step isn't in the URL; it moves focus to its question.
      if (wizard) {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: 0 });
          questionRef.current?.focus();
        });
        return;
      }
      const url = new URL(window.location.href);
      if (next === defaultTab) url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState(window.history.state, "", url);
    },
    [defaultTab, wizard],
  );

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);
  const issues = useMemo(() => sectionIssues(draft), [draft]);
  const blocking = issues.filter((i) => i.blocking);
  const warnings = issues.length - blocking.length;
  const { confirmLeave, dialog: guardDialog } = useUnsavedGuard(dirty, existing?.name ?? "this rule");

  // A new rule's schedule defaults to the workspace time zone, which may
  // arrive after the draft is created. Once the author picks "schedule",
  // their own choice stands.
  const { data: workspace } = useWorkspace();
  const workspaceTz = workspace?.timezone;
  useEffect(() => {
    if (existing || !workspaceTz) return;
    const tz = (d: RuleDraft) => (d.when.type === "schedule" ? d : { ...d, when: { ...d.when, timezone: workspaceTz } });
    setDraft(tz);
    setBaseline(tz);
  }, [existing, workspaceTz]);

  // Read after mount — localStorage isn't available during server render.
  useEffect(() => setMode(readMode()), []);

  function changeMode(next: EditorMode) {
    setMode(next);
    writeMode(next);
  }

  const live = liveSelection(draft, selection);

  /** Go to a section: its tab (and, in Ladder, its element on the rung). */
  const goTo = useCallback(
    (section: RuleSection) => {
      if (section === "name") {
        if (wizard) setTab("review");
        window.requestAnimationFrame(() => nameRef.current?.focus());
        return;
      }
      setTab(section);
      if (mode === "ladder") {
        const first = contacts(draft.condition)[0];
        setSelection(
          section === "when"
            ? { kind: "when" }
            : section === "if"
              ? first
                ? { kind: "node", id: first.id }
                : null
              : section === "then"
                ? draft.actions[0]
                  ? { kind: "action", id: draft.actions[0].id }
                  : { kind: "add-action" }
                : { kind: "timing" },
        );
      }
    },
    [mode, draft, setTab, wizard],
  );

  /** Wizard Next: refused while this step has problems that block saving. */
  function next() {
    const stopping = blocking.filter((i) => i.section === tab);
    if (stopping.length > 0) {
      toast({ tone: "error", title: "Fix the marked items first", detail: stopping[0].message });
      return;
    }
    setTab(tabs[stepIndex + 1]);
  }

  async function save() {
    setError(null);
    // Blocking issues stop the save and take you to the first one (DESIGN.md §7).
    if (blocking.length > 0) {
      goTo(blocking[0].section);
      toast({ tone: "error", title: `${blocking.length} to fix`, detail: blocking[0].message });
      return;
    }
    const problem = validateDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    // A live rule acts on the next reading: say so before saving (§9.8).
    if (existing?.enabled) {
      const ok = await confirm("Changes apply from the next reading. The rule's history and versions are kept.", {
        title: `Save changes to ${existing.name}?`,
        confirmLabel: "Save changes",
        danger: false,
      });
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      const body = draftToRequest(draft);
      const saved = existing
        ? await api.patch<RuleResponse>(`/rules/${existing.id}`, body)
        : await api.post<RuleResponse>(`/rules`, body);
      // The toast says what changed, from the version the save just wrote.
      let detail: string | undefined;
      try {
        const [latest] = await api.get<RuleVersionResponse[]>(`/rules/${saved.id}/versions`);
        if (existing && latest) detail = `${latest.change_lines.length} change${latest.change_lines.length === 1 ? "" : "s"}: ${latest.change_lines.join("; ")}`;
      } catch {
        // The save succeeded; only the summary is missing.
      }
      toast({ title: existing ? `${saved.name} saved` : `${saved.name} created`, detail });
      // The editor stays on the record (DESIGN.md §7): what's saved is the new baseline.
      setBaseline(draft);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save this rule.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Enter in a wizard step moves on; only Review creates.
    if (wizard && tab !== "review") next();
    else void save();
  }

  // Ctrl/⌘+S saves.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!document.querySelector('[role="alertdialog"]')) void saveRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function cancel() {
    if (onCancel && (await confirmLeave())) onCancel();
  }

  /** The sentence's "Open full condition": the If tab, in Form. */
  function openFull() {
    changeMode("form");
    setTab("if");
  }

  const nameFields = (
    <>
      <Field label="Rule name" hint="Left blank, a name is generated." error={draft.name.trim().length > MAX_NAME ? `Keep the name to ${MAX_NAME} characters.` : undefined}>
        <Input ref={nameRef} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Boiler overheat interlock" />
      </Field>
      <SwitchField
        label="Status"
        checked={draft.enabled}
        onChange={(enabled) => setDraft({ ...draft, enabled })}
        onLabel="Enabled"
        offLabel="Disabled"
        onHint="Fires when its trigger and conditions are met."
        offHint="Keeps its settings and history, but won't fire."
      />
    </>
  );

  const preview = <RulePreview draft={draft} catalog={catalog} ruleId={existing?.id} />;
  const tabIssues = (t: RuleTab | RuleSection) => issues.filter((i) => i.section === t);
  const modeSwitch = (
    <div className="flex justify-end">
      <SegmentedControl
        ariaLabel="Editor view"
        value={mode}
        onChange={changeMode}
        options={[
          { value: "form", label: "Form" },
          {
            value: "ladder",
            label: (
              <span className="inline-flex items-center gap-1.5">
                Ladder
                <Tag tone="neutral" size="sm">
                  expert
                </Tag>
              </span>
            ),
          },
        ]}
      />
    </div>
  );
  const ladder = (
    <>
      <LadderCanvas draft={draft} catalog={catalog} update={setDraft} selection={live} onSelect={setSelection} />
      <LadderInspector draft={draft} catalog={catalog} update={setDraft} selection={live} onSelect={setSelection} nameFields={nameFields} />
    </>
  );
  // Every tab stays mounted (hidden), so its fields keep their state.
  const panel = (t: RuleTab, children: ReactNode) => (
    <div key={t} role="tabpanel" id={`tabpanel-${t}`} aria-labelledby={`tab-${t}`} hidden={tab !== t} className="flex flex-col gap-4">
      {children}
    </div>
  );

  return (
    <>
      <form onSubmit={handleSubmit} className="@container flex flex-col gap-4">
        {wizard && (
          <Stepper
            current={stepIndex}
            steps={tabs.map((t) => ({ id: t, label: TAB_LABEL[t], issues: tabIssues(t === "review" ? "name" : t).filter((i) => i.blocking).length }))}
          />
        )}
        {!wizard && <div className="grid items-start gap-x-4 gap-y-3 @min-[640px]:grid-cols-2">{nameFields}</div>}

        {/* The rule as a sentence in a highlighted box (DESIGN.md §9.3). */}
        <div className="rounded-xl border border-accent/30 bg-accent-muted/60 px-4 py-3">
          <EditableSentence draft={draft} catalog={catalog} update={setDraft} onOpenFull={openFull} />
        </div>

        <div className="flex items-end gap-2">
          {wizard ? (
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-2">
              <h2 ref={questionRef} tabIndex={-1} className="text-xl font-semibold tracking-[-0.01em] text-ink outline-none">
                {QUESTION[tab]?.[0]}
              </h2>
              <p className="text-ink-muted">{QUESTION[tab]?.[1]}</p>
            </div>
          ) : (
            <Tabs
              ariaLabel="Rule sections"
              className="min-w-0 flex-1"
              tabs={tabs.map((t) => {
                const its = tabIssues(t);
                const bad = its.filter((i) => i.blocking).length;
                return { id: t, label: TAB_LABEL[t], issues: bad, warn: its.length > bad };
              })}
              active={tab}
              onChange={(id) => setTab(id as RuleTab)}
            />
          )}
          {tab !== "review" && (
            <Button type="button" variant="secondary" size="sm" className="mb-1.5 @min-[1080px]:hidden" onClick={() => setPreviewOpen(true)}>
              <Activity aria-hidden size={14} />
              Preview
            </Button>
          )}
        </div>

        <div className="grid items-start gap-6 @min-[1080px]:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            {panel("when", <WhenSection draft={draft} catalog={catalog} update={setDraft} />)}
            {panel(
              "if",
              <>
                {modeSwitch}
                {mode === "form" ? <ConditionSection draft={draft} catalog={catalog} update={setDraft} /> : tab === "if" && ladder}
              </>,
            )}
            {panel(
              "then",
              <>
                {modeSwitch}
                {mode === "form" ? <ThenSection draft={draft} catalog={catalog} update={setDraft} /> : tab === "then" && ladder}
              </>,
            )}
            {panel("behaviour", <BehaviourSection draft={draft} update={setDraft} />)}
            {activity && panel("activity", activity)}
            {wizard &&
              panel(
                "review",
                <>
                  <div className="grid items-start gap-x-4 gap-y-3 rounded-xl border border-border bg-surface p-5 shadow-card @min-[640px]:grid-cols-2">
                    {nameFields}
                  </div>
                  {/* "See what it would have done": the preview, full width when there's no column for it. */}
                  <div className="flex flex-col gap-3 @min-[1080px]:hidden">{preview}</div>
                </>,
              )}
          </div>

          <aside aria-label="Preview" className="hidden min-w-0 flex-col gap-3 @min-[1080px]:sticky @min-[1080px]:top-4 @min-[1080px]:flex @min-[1080px]:max-h-[calc(100vh-112px)] @min-[1080px]:overflow-y-auto">
            {preview}
          </aside>
        </div>

        {/* One sticky save bar (DESIGN.md §7); Activity has nothing to save. */}
        <div
          hidden={tab === "activity"}
          className="sticky bottom-[var(--tabbar-h)] z-[6] -mx-4 flex flex-wrap items-center gap-2.5 border-t border-border bg-canvas/92 px-4 pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur-[10px] max-rail:pb-3 rail:-mx-10 rail:px-10"
        >
          <div className="flex min-w-[150px] flex-1 flex-wrap items-center gap-2.5 text-[13px] text-ink-muted">
            <span aria-live="polite" className="inline-flex items-center gap-1.5">
              {submitting ? (
                "Saving…"
              ) : dirty ? (
                <>
                  <span aria-hidden className="h-2 w-2 rounded-full bg-status-pending" />
                  Unsaved changes
                </>
              ) : isNew ? (
                "New rule, not created yet"
              ) : (
                <>
                  <Check aria-hidden size={14} className="text-status-online" />
                  All changes saved
                </>
              )}
            </span>
            {blocking.length > 0 && (
              <button
                type="button"
                onClick={() => goTo(blocking[0].section)}
                className="inline-flex h-7 items-center gap-[5px] rounded-full bg-status-error-surface px-2.5 text-[12.5px] font-semibold text-status-error"
              >
                <AlertCircle aria-hidden size={13} />
                {blocking.length} to fix
              </button>
            )}
            {warnings > 0 && (
              <button
                type="button"
                onClick={() => goTo(issues.find((i) => !i.blocking)!.section)}
                className="inline-flex h-7 items-center gap-[5px] rounded-full bg-status-pending-surface px-2.5 text-[12.5px] font-semibold text-status-pending"
              >
                <AlertTriangle aria-hidden size={13} />
                {warnings} safety warning{warnings === 1 ? "" : "s"}
              </button>
            )}
            {error && (
              <p role="alert" className="text-sm text-status-error">
                {error}
              </p>
            )}
          </div>
          {wizard ? (
            // The wizard (DESIGN.md §5): Back (the recipes, on the first step), then Next: {step}.
            <div className="flex items-center gap-2">
              {stepIndex > 0 ? (
                <Button type="button" variant="ghost" onClick={() => setTab(tabs[stepIndex - 1])}>
                  <ChevronLeft aria-hidden size={15} />
                  Back
                </Button>
              ) : (
                onCancel && (
                  <Button type="button" variant="ghost" onClick={() => void cancel()}>
                    <ChevronLeft aria-hidden size={15} />
                    Recipes
                  </Button>
                )
              )}
              {stepIndex < tabs.length - 1 ? (
                // Keyed apart: React would otherwise reuse this element as the submit
                // button mid-click, and the click would create the rule.
                <Button key="next" type="button" onClick={next}>
                  Next: {TAB_LABEL[tabs[stepIndex + 1]]}
                  <ChevronRight aria-hidden size={15} />
                </Button>
              ) : (
                <Button key="create" type="submit" disabled={submitting}>
                  {submitting ? "Saving…" : "Create rule"}
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" disabled={!dirty || submitting} onClick={() => setDraft(baseline)}>
                Discard
              </Button>
              <Button type="submit" disabled={submitting || !dirty}>
                {submitting ? "Saving…" : "Save changes"}
              </Button>
            </div>
          )}
        </div>
      </form>
      <ItemSheet open={previewOpen} onClose={() => setPreviewOpen(false)} title="Preview" sub="What this draft would do. Nothing is sent.">
        <div className="flex flex-col gap-3">{preview}</div>
      </ItemSheet>
      {dialog}
      {guardDialog}
    </>
  );
}
