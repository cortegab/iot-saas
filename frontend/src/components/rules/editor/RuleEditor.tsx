"use client";

/**
 * Create/edit a rule in one of two equivalent views over the same RuleDraft:
 * Form (sections, top to bottom) and Ladder (a PLC-style rung). Switching is
 * lossless — both edit the draft through the same `rule-draft` operations.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useApi } from "@/hooks/useApi";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ApiRequestError } from "@/lib/api-client";
import {
  draftFromRule,
  draftToRequest,
  emptyDraft,
  validateDraft,
  type RuleDraft,
} from "@/lib/rule-draft";
import { RuleSummary, type RuleSummaryData } from "@/components/rules/RuleSummary";
import { LadderMode } from "@/components/rules/ladder/LadderMode";
import type { components } from "@/types/api";
import { FormMode } from "./FormMode";
import { SECTION_LABEL } from "./fields";
import { useRuleCatalog } from "./useRuleCatalog";

type RuleResponse = components["schemas"]["RuleResponse"];
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

export function RuleEditor({
  deviceId,
  existing,
  onSaved,
  onCancel,
}: {
  /** Seeds the first condition and action device for a new rule. */
  deviceId?: string;
  existing?: RuleResponse;
  onSaved: (saved: RuleResponse) => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const catalog = useRuleCatalog();
  const [draft, setDraft] = useState<RuleDraft>(() =>
    existing ? draftFromRule(existing) : emptyDraft(deviceId ?? ""),
  );
  const [mode, setMode] = useState<EditorMode>("form");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A new rule's schedule defaults to the workspace time zone, which may
  // arrive after the draft is created. Once the author picks "schedule",
  // their own choice stands.
  const { data: workspace } = useWorkspace();
  const workspaceTz = workspace?.timezone;
  useEffect(() => {
    if (existing || !workspaceTz) return;
    setDraft((d) => (d.when.type === "schedule" ? d : { ...d, when: { ...d.when, timezone: workspaceTz } }));
  }, [existing, workspaceTz]);

  // Read after mount — localStorage isn't available during server render.
  useEffect(() => setMode(readMode()), []);

  function changeMode(next: EditorMode) {
    setMode(next);
    writeMode(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = validateDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    try {
      const body = draftToRequest(draft);
      const saved = existing
        ? await api.patch<RuleResponse>(`/rules/${existing.id}`, body)
        : await api.post<RuleResponse>(`/rules`, body);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save this rule.");
    } finally {
      setSubmitting(false);
    }
  }

  // The preview must render even while fields are half-filled (an unparsable
  // webhook body would make draftToRequest throw).
  let preview: RuleSummaryData | null = null;
  try {
    preview = draftToRequest(draft) as unknown as RuleSummaryData;
  } catch {
    preview = null;
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      <Card padding="md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Field label="Rule name" hint="Left blank, a name is generated." className="flex-1">
            <Input
              compact
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Boiler overheat interlock"
            />
          </Field>
          <SegmentedControl
            ariaLabel="Editor view"
            value={mode}
            onChange={changeMode}
            options={[
              { value: "form", label: "Form" },
              { value: "ladder", label: "Ladder" },
            ]}
          />
        </div>
      </Card>

      {mode === "form" ? (
        <FormMode draft={draft} catalog={catalog} update={setDraft} />
      ) : (
        <LadderMode draft={draft} catalog={catalog} update={setDraft} />
      )}

      <Card padding="md">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="accent-accent"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          Enabled
        </label>
      </Card>

      {preview && (
        <Card padding="md">
          <div className="flex flex-col gap-1">
            <span className={SECTION_LABEL}>Summary</span>
            <RuleSummary
              rule={preview}
              placeholder="…"
              className="text-[15px] leading-relaxed"
              deviceNameById={catalog.deviceNameById}
            />
          </div>
        </Card>
      )}

      {error && (
        <p role="alert" className="text-sm text-status-error">
          {error}
        </p>
      )}

      <div className="flex gap-3 border-t border-border pt-4">
        <Button type="submit" size="md" disabled={submitting}>
          {submitting ? "Saving…" : existing ? "Save changes" : "Create rule"}
        </Button>
        <Button type="button" variant="secondary" size="md" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
