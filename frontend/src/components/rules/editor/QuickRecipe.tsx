"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, SlidersHorizontal } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { EditableSentence } from "@/components/rules/editor/EditableSentence";
import { useRuleCatalog, type RuleCatalog } from "@/components/rules/editor/useRuleCatalog";
import { EDITOR_COLUMN, SAVE_BAR } from "@/components/editor/save-bar";
import { ApiRequestError } from "@/lib/api-client";
import { OPERATORS, contacts, draftToRequest, isReadingRule, validateDraft, type ActuatorActionDraft, type ContactDraft, type DraftNode, type RuleDraft } from "@/lib/rule-draft";
import { sectionIssues } from "@/lib/rule-preview";
import { cronHuman } from "@/lib/schedule";
import type { Recipe } from "@/lib/rule-recipes";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];

/** Replace one contact (by id) anywhere in the condition tree. */
function withContact(node: DraftNode | null, next: ContactDraft): DraftNode | null {
  if (!node) return node;
  if (node.kind === "contact") return node.id === next.id ? next : node;
  return { ...node, children: node.children.map((c) => withContact(c, next)!) };
}

/** "> above" → "above". */
const operatorWords = (op: string) => OPERATORS.find((o) => o.value === op)?.label.replace(/^\S+\s/, "") ?? op;

/** On/off outputs only: recipes switch things on or off. */
function switchableOptions(catalog: RuleCatalog, deviceId: string) {
  return catalog.actuatorOptionsFor(deviceId).filter((o) => (catalog.actuatorFor(deviceId, o.id)?.value_type ?? "bool") === "bool");
}

/**
 * A recipe as one screen (DESIGN.md §9.1, ease-of-use plan B1): the blanks a
 * recipe leaves (which device, which reading, the limit, which output) as
 * plain fields, the rule as its sentence, the safety settings said in one
 * line, and Create. **Customize** opens the full step-by-step editor on the
 * same draft, so nothing typed here is lost. The draft keeps the recipe's
 * hold time, hysteresis and cooldown: this screen never removes them (§9.7).
 */
export function QuickRecipe({
  recipe,
  initialDraft,
  onSaved,
  onCustomize,
  onBack,
}: {
  recipe: Pick<Recipe, "title" | "description">;
  initialDraft: RuleDraft;
  onSaved: (saved: RuleResponse) => void;
  onCustomize: (draft: RuleDraft) => void;
  onBack: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const catalog = useRuleCatalog();
  const [draft, setDraft] = useState<RuleDraft>(initialDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const blocking = useMemo(() => sectionIssues(draft).filter((i) => i.blocking), [draft]);

  const w = draft.when;
  const leafs = contacts(draft.condition);
  const outputs = draft.actions.filter((a): a is ActuatorActionDraft => a.kind === "actuator");
  const withReadings = catalog.devices.filter((d) => catalog.metricOptionsFor(d.id).length > 0);
  const withOutputs = catalog.devices.filter((d) => switchableOptions(catalog, d.id).length > 0);

  function setContact(c: ContactDraft, patch: Partial<ContactDraft>) {
    setDraft((d) => ({ ...d, condition: withContact(d.condition, { ...c, ...patch }) }));
  }
  function setOutput(a: ActuatorActionDraft, patch: Partial<ActuatorActionDraft>) {
    setDraft((d) => ({ ...d, actions: d.actions.map((x) => (x.id === a.id ? ({ ...a, ...patch } as ActuatorActionDraft) : x)) }));
  }

  async function create() {
    setTried(true);
    setError(null);
    if (blocking.length > 0) return;
    const problem = validateDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    try {
      const saved = await api.post<RuleResponse>(`/rules`, draftToRequest(draft));
      toast({ title: `${saved.name} created`, detail: "It applies within a second." });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't create this rule.");
    } finally {
      setSubmitting(false);
    }
  }

  const rows: ReactNode[] = [];

  if (w.type === "device_status") {
    rows.push(
      <Field key="status" label="Which device">
        <Select value={w.statusDeviceId} onChange={(e) => setDraft((d) => ({ ...d, when: { ...d.when, statusDeviceId: e.target.value } }))}>
          <option value="">Pick a device</option>
          {catalog.devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>,
    );
  }
  if (w.type === "schedule") {
    rows.push(
      <p key="schedule" className="text-sm text-ink">
        Runs <b className="font-medium">{cronHuman(w.cron)}</b>. Change the time and days in Customize.
      </p>,
    );
  }

  leafs.forEach((c, i) => {
    const metric = c.deviceId ? catalog.metricFor(c.deviceId, c.metric) : undefined;
    const numeric = metric?.data_type !== "bool";
    const options = c.deviceId ? catalog.metricOptionsFor(c.deviceId) : [];
    rows.push(
      <Fragment key={c.id}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={leafs.length > 1 ? `Device ${i + 1}` : "Device it reads"}>
            <Select
              value={c.deviceId}
              onChange={(e) => {
                const deviceId = e.target.value;
                const first = catalog.metricOptionsFor(deviceId)[0]?.id ?? "";
                const keep = catalog.metricOptionsFor(deviceId).some((o) => o.id === c.metric);
                setContact(c, { deviceId, metric: keep ? c.metric : first });
              }}
            >
              <option value="">Pick a device</option>
              {withReadings.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reading">
            <Select value={c.metric} disabled={!c.deviceId} onChange={(e) => setContact(c, { metric: e.target.value })}>
              {!c.deviceId && <option value="">Pick the device first</option>}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {numeric && c.rhsKind === "static" && (
          <Field label={`When it's ${operatorWords(c.operator)}`} hint={metric?.unit ? `In ${metric.unit}.` : undefined}>
            <Input
              inputMode="decimal"
              className="max-w-[160px]"
              value={String(c.value)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (e.target.value.trim() !== "" && Number.isFinite(n)) setContact(c, { value: n });
              }}
            />
          </Field>
        )}
      </Fragment>,
    );
  });

  outputs.forEach((a, i) => {
    const options = a.deviceId ? switchableOptions(catalog, a.deviceId) : [];
    rows.push(
      <div key={a.id} className="grid gap-3 sm:grid-cols-2">
        <Field label={outputs.length > 1 ? `Output ${i + 1}: device` : `Device it switches ${a.bool ? "on" : "off"}`}>
          <Select
            value={a.deviceId}
            onChange={(e) => {
              const deviceId = e.target.value;
              const opts = switchableOptions(catalog, deviceId);
              setOutput(a, { deviceId, actuator: opts.some((o) => o.id === a.actuator) ? a.actuator : (opts[0]?.id ?? "") });
            }}
          >
            <option value="">Pick a device</option>
            {withOutputs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Output">
          <Select value={a.actuator} disabled={!a.deviceId} onChange={(e) => setOutput(a, { actuator: e.target.value })}>
            {!a.deviceId && <option value="">Pick the device first</option>}
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>,
    );
  });

  // The safety settings the recipe chose, in one line (they stay on; Customize changes them).
  const safety = isReadingRule(draft)
    ? [
        draft.forDuration > 0 ? `waits ${draft.forDuration} s before acting` : "acts at once",
        (() => {
          const c = leafs.find((x) => x.hysteresis > 0);
          if (!c) return null;
          const unit = c.deviceId ? catalog.metricFor(c.deviceId, c.metric)?.unit : undefined;
          return `re-arms only once the reading is ${c.hysteresis}${unit ? ` ${unit}` : ""} back past the limit`;
        })(),
        draft.cooldown > 0 ? `acts at most once every ${draft.cooldown} s` : null,
      ].filter(Boolean)
    : [];

  const shownIssues = tried ? blocking : [];

  return (
    <>
      <section aria-label="Quick rule" className={`flex flex-col gap-5 ${EDITOR_COLUMN}`}>
        <div className="flex flex-col gap-1">
          <h2 className="text-section font-semibold text-ink">{recipe.title}</h2>
          <p className="text-sm text-ink-muted">{recipe.description}</p>
        </div>

        <div className="rounded-lg border border-accent/30 bg-accent-muted px-4 py-3">
          <EditableSentence draft={draft} catalog={catalog} update={setDraft} onOpenFull={() => onCustomize(draft)} />
        </div>

        <div className="flex flex-col gap-4">{rows}</div>

        <Field label="Name">
          <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </Field>

        {safety.length > 0 && (
          <p className="text-meta text-ink-muted">
            To protect what it switches, it {safety.join(", ")}. Change these in Customize.
          </p>
        )}

        {shownIssues.length > 0 && (
          <div role="alert">
            <Callout tone="error">
              <b className="font-medium">{shownIssues[0].message}</b>
              {shownIssues.length > 1 && ` And ${shownIssues.length - 1} more.`}
            </Callout>
          </div>
        )}
        {error && (
          <div role="alert">
            <Callout tone="error">{error}</Callout>
          </div>
        )}
      </section>

      <div data-savebar className={SAVE_BAR}>
        <span className="mr-auto text-meta text-ink-muted">Not created yet</span>
        <Button type="button" variant="ghost" onClick={onBack}>
          <ChevronLeft aria-hidden size={15} />
          Recipes
        </Button>
        <Button type="button" variant="secondary" onClick={() => onCustomize(draft)}>
          <SlidersHorizontal aria-hidden size={15} />
          Customize
        </Button>
        <Button type="button" disabled={submitting} onClick={() => void create()}>
          {submitting ? "Creating…" : "Create rule"}
        </Button>
      </div>
    </>
  );
}
