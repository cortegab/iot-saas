"use client";

/**
 * Create/edit a rule in one of two equivalent views over the same RuleDraft:
 * Form (sections, top to bottom) and Ladder (a PLC-style rung). Switching is
 * lossless — both edit the draft through the same `rule-draft` operations.
 *
 * The frame (DESIGN.md §9.2, demo A) never moves between views: the section
 * rail on the left, the canvas in the middle (form sections or the rung), a
 * 340 px column on the right (the preview in Form; the inspector over a
 * folded preview in Ladder), and one sticky save bar.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertCircle, AlertTriangle, Check } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Badge";
import { SwitchField } from "@/components/ui/Switch";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ApiRequestError } from "@/lib/api-client";
import { contacts, draftFromRule, draftToRequest, emptyDraft, validateDraft, type RuleDraft } from "@/lib/rule-draft";
import { MAX_NAME, sectionIssues, type RuleSection } from "@/lib/rule-preview";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useUnsavedGuard } from "@/components/editor/useUnsavedGuard";
import { EditableSentence } from "./EditableSentence";
import { LadderCanvas, LadderInspector, liveSelection, type EditorSelection } from "@/components/rules/ladder/LadderMode";
import type { components } from "@/types/api";
import { FormMode } from "./FormMode";
import { SectionCard, StepsContext } from "./fields";
import { RulePreview } from "./RulePreview";
import { RuleRail } from "./RuleRail";
import { useRuleCatalog } from "./useRuleCatalog";

type RuleResponse = components["schemas"]["RuleResponse"];
type RuleVersionResponse = components["schemas"]["RuleVersionResponse"];
type EditorMode = "form" | "ladder";

const MODE_KEY = "rule-editor-mode";

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

/** The rail section a ladder selection belongs to. */
function sectionOf(s: EditorSelection): RuleSection | null {
  if (!s) return null;
  if (s.kind === "when") return "when";
  if (s.kind === "node") return "if";
  if (s.kind === "action" || s.kind === "add-action") return "then";
  if (s.kind === "timing") return "behaviour";
  return "name";
}

export function RuleEditor({
  deviceId,
  existing,
  initialDraft,
  onSaved,
  onCancel,
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
}) {
  const api = useApi();
  const catalog = useRuleCatalog();
  // The baseline is what's saved; a restored version (initialDraft over an
  // existing rule) starts as unsaved changes against it.
  const [baseline, setBaseline] = useState<RuleDraft>(() => (existing ? draftFromRule(existing) : (initialDraft ?? emptyDraft(deviceId ?? ""))));
  const [draft, setDraft] = useState<RuleDraft>(() => (existing && initialDraft ? initialDraft : baseline));
  const [mode, setMode] = useState<EditorMode>("form");
  const [selection, setSelection] = useState<EditorSelection>({ kind: "when" });
  const [picked, setPicked] = useState<RuleSection>("when");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const isNew = !existing;

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
  const active: RuleSection | null = mode === "ladder" ? sectionOf(live) : picked;

  /** Go to a section: scroll to it in Form, select it on the rung in Ladder. */
  const goTo = useCallback(
    (section: RuleSection) => {
      setPicked(section);
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
                : section === "behaviour"
                  ? { kind: "timing" }
                  : { kind: "name" },
        );
        return;
      }
      window.requestAnimationFrame(() => document.getElementById(`rule-sec-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    },
    [mode, draft],
  );

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
    void save();
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

  function openFull() {
    changeMode("form");
    window.requestAnimationFrame(() => document.getElementById("rule-sec-when")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const nameFields = (
    <>
      <Field label="Rule name" hint="Left blank, a name is generated." error={draft.name.trim().length > MAX_NAME ? `Keep the name to ${MAX_NAME} characters.` : undefined}>
        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Boiler overheat interlock" />
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

  return (
    <StepsContext.Provider value={isNew}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* demo G: the rule as a sentence in a highlighted box. */}
        <div className="rounded-xl border border-accent/30 bg-accent-muted/60 px-4 py-3">
          <EditableSentence draft={draft} catalog={catalog} update={setDraft} onOpenFull={openFull} />
        </div>
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

        <div className="grid items-start gap-x-6 gap-y-4 shell:grid-cols-[minmax(0,1fr)_320px] wb:grid-cols-[200px_minmax(0,1fr)_340px]">
          <RuleRail issues={issues} isNew={isNew} active={active} onPick={goTo} className="shell:col-span-2 wb:col-span-1" />

          <div className="flex min-w-0 flex-col gap-4">
            {mode === "form" ? (
              <>
                <FormMode draft={draft} catalog={catalog} update={setDraft} />
                <SectionCard id="name" title="Name" step={5}>
                  {nameFields}
                </SectionCard>
              </>
            ) : (
              <LadderCanvas draft={draft} catalog={catalog} update={setDraft} selection={live} onSelect={setSelection} />
            )}
          </div>

          <aside aria-label={mode === "form" ? "Preview" : "Inspector and preview"} className="flex min-w-0 flex-col gap-3 shell:sticky shell:top-4 shell:max-h-[calc(100vh-112px)] shell:overflow-y-auto">
            {mode === "form" ? (
              preview
            ) : (
              <>
                <LadderInspector draft={draft} catalog={catalog} update={setDraft} selection={live} onSelect={setSelection} nameFields={nameFields} />
                <details className="group rounded-xl border border-border bg-surface shadow-card">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[13px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                    Preview
                    <span className="text-[12.5px] font-normal text-ink-muted">
                      {blocking.length ? `${blocking.length} to fix` : warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "checks pass"} ▾
                    </span>
                  </summary>
                  <div className="px-3 pb-3">{preview}</div>
                </details>
              </>
            )}
          </aside>
        </div>

        {/* One sticky save bar for both views (DESIGN.md §7). */}
        <div className="sticky bottom-0 z-[6] -mx-4 flex flex-wrap items-center gap-2.5 border-t border-border bg-canvas/92 px-4 pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur-[10px] md:-mx-10 md:px-10">
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
          <div className="flex items-center gap-2">
            {isNew && onCancel ? (
              <Button type="button" variant="ghost" onClick={() => void cancel()}>
                Cancel
              </Button>
            ) : (
              <Button type="button" variant="ghost" disabled={!dirty || submitting} onClick={() => setDraft(baseline)}>
                Discard
              </Button>
            )}
            <Button type="submit" disabled={submitting || (!dirty && !isNew)}>
              {submitting ? "Saving…" : existing ? "Save changes" : "Create rule"}
            </Button>
          </div>
        </div>
      </form>
      {dialog}
      {guardDialog}
    </StepsContext.Provider>
  );
}
