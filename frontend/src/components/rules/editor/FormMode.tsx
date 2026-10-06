"use client";

import { Fragment } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { cn } from "@/lib/cn";
import {
  canClear,
  emptyAction,
  emptyContact,
  flappingRisk,
  insertBeside,
  isReadingRule,
  newId,
  removeNode,
  setGroupOp,
  updateContact,
  type ActionDraft,
  type Combinator,
  type ContactDraft,
  type DraftNode,
  type GroupDraft,
  type RuleDraft,
} from "@/lib/rule-draft";
import {
  ActionFields,
  AddActionMenu,
  ContactFields,
  FieldRow,
  NumberSafetyField,
  SECTION_LABEL,
  SectionCard,
  WhenFields,
  actionLabel,
} from "./fields";
import type { RuleCatalog } from "./useRuleCatalog";

type Update = (next: RuleDraft) => void;

const OP_WORDS: Record<Combinator, string> = { AND: "All of these", OR: "Any of these" };

/** The device a newly added contact/action starts on — the last one used. */
export function lastDevice(draft: RuleDraft): string {
  const find = (node: DraftNode | null): string => {
    if (node === null) return "";
    if (node.kind === "contact") return node.deviceId;
    return find(node.children[node.children.length - 1]);
  };
  return find(draft.condition) || draft.when.statusDeviceId;
}

function ContactCard({
  contact,
  catalog,
  onChange,
  onRemove,
}: {
  contact: ContactDraft;
  catalog: RuleCatalog;
  onChange: (patch: Partial<ContactDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <ContactFields contact={contact} catalog={catalog} onChange={onChange} />
      <Button type="button" variant="link" className="self-end text-xs" onClick={onRemove}>
        <Trash2 size={13} aria-hidden /> Remove condition
      </Button>
    </div>
  );
}

function ConditionNodeEditor({
  node,
  draft,
  catalog,
  update,
  depth,
}: {
  node: DraftNode;
  draft: RuleDraft;
  catalog: RuleCatalog;
  update: Update;
  depth: number;
}) {
  const setCondition = (condition: DraftNode | null) => update({ ...draft, condition });

  if (node.kind === "contact") {
    return (
      <ContactCard
        contact={node}
        catalog={catalog}
        onChange={(patch) => setCondition(updateContact(draft.condition, node.id, patch))}
        onRemove={() => setCondition(removeNode(draft.condition, node.id))}
      />
    );
  }

  const group: GroupDraft = node;
  const last = group.children[group.children.length - 1];
  const device = lastDevice(draft);
  const addContact = () =>
    setCondition(insertBeside(draft.condition, last.id, emptyContact(device), group.op));
  const addGroup = () => {
    const op: Combinator = group.op === "AND" ? "OR" : "AND";
    const sub: GroupDraft = {
      kind: "group",
      id: newId(),
      op,
      children: [emptyContact(device), emptyContact(device)],
    };
    setCondition(insertBeside(draft.condition, last.id, sub, group.op));
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-3",
        depth === 0 ? "border-transparent p-0" : "border-dashed border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          ariaLabel="Combine with"
          value={group.op}
          onChange={(op) => setCondition(setGroupOp(draft.condition, group.id, op))}
          options={[
            { value: "AND", label: "All of these (AND)" },
            { value: "OR", label: "Any of these (OR)" },
          ]}
        />
        {depth > 0 && (
          <Button
            type="button"
            variant="link"
            className="ml-auto text-xs"
            onClick={() => setCondition(removeNode(draft.condition, group.id))}
          >
            <Trash2 size={13} aria-hidden /> Remove group
          </Button>
        )}
      </div>
      {group.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && (
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className={SECTION_LABEL}>{group.op === "AND" ? "and" : "or"}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
          <ConditionNodeEditor node={child} draft={draft} catalog={catalog} update={update} depth={depth + 1} />
        </Fragment>
      ))}
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" variant="link" onClick={addContact}>
          <Plus size={14} aria-hidden /> Condition
        </Button>
        <Button type="button" variant="link" onClick={addGroup}>
          <Plus size={14} aria-hidden /> {OP_WORDS[group.op === "AND" ? "OR" : "AND"]} group
        </Button>
      </div>
    </div>
  );
}

function ConditionSection({ draft, catalog, update }: { draft: RuleDraft; catalog: RuleCatalog; update: Update }) {
  const reading = isReadingRule(draft);
  const root = draft.condition;
  const device = lastDevice(draft);
  const title = reading ? "If" : "If (optional)";

  if (root === null) {
    return (
      <SectionCard title={title}>
        <p className="text-sm text-ink-muted">
          {reading ? "Add the condition to check on each reading." : "No condition — it always runs when triggered."}
        </p>
        <Button
          type="button"
          variant="link"
          className="self-start"
          onClick={() => update({ ...draft, condition: emptyContact(device) })}
        >
          <Plus size={14} aria-hidden /> Add condition
        </Button>
      </SectionCard>
    );
  }

  if (root.kind === "contact") {
    return (
      <SectionCard title={title}>
        <ConditionNodeEditor node={root} draft={draft} catalog={catalog} update={update} depth={0} />
        <div className="flex flex-wrap gap-1.5">
          {(["AND", "OR"] as const).map((op) => (
            <Button
              key={op}
              type="button"
              variant="link"
              onClick={() =>
                update({ ...draft, condition: insertBeside(root, root.id, emptyContact(device), op) })
              }
            >
              <Plus size={14} aria-hidden /> {op === "AND" ? "And" : "Or"} condition
            </Button>
          ))}
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={title}>
      <ConditionNodeEditor node={root} draft={draft} catalog={catalog} update={update} depth={0} />
    </SectionCard>
  );
}

function ThenSection({ draft, catalog, update }: { draft: RuleDraft; catalog: RuleCatalog; update: Update }) {
  const clearing = canClear(draft);
  const setActions = (actions: ActionDraft[]) => update({ ...draft, actions });

  return (
    <SectionCard
      title="Then"
      step={2}
      aside={draft.actions.length > 1 && <span className="text-xs text-ink-muted">All run together</span>}
    >
      {draft.actions.map((action, i) => {
        const label = actionLabel(action, catalog);
        return (
          <div key={action.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium text-ink">
                {label.title}
                <span className="ml-2 font-normal text-ink-muted">{label.detail}</span>
              </span>
              <Button
                type="button"
                variant="link"
                className="text-xs"
                disabled={draft.actions.length === 1 && draft.preserved.actions.length === 0}
                onClick={() => setActions(draft.actions.filter((_, j) => j !== i))}
              >
                <Trash2 size={13} aria-hidden /> Remove
              </Button>
            </div>
            <ActionFields
              action={action}
              catalog={catalog}
              clearing={clearing}
              onChange={(next) => setActions(draft.actions.map((a, j) => (j === i ? next : a)))}
            />
          </div>
        );
      })}
      {draft.preserved.actions.length > 0 && (
        <p className="text-sm text-ink-muted">
          Also keeps {draft.preserved.actions.length} action
          {draft.preserved.actions.length === 1 ? "" : "s"} set through the API.
        </p>
      )}
      <AddActionMenu onAdd={(kind) => setActions([...draft.actions, emptyAction(kind, lastDevice(draft))])} />
    </SectionCard>
  );
}

export function BehaviourSection({ draft, update }: { draft: RuleDraft; update: Update }) {
  return (
    <SectionCard title={isReadingRule(draft) ? "Safety and behaviour" : "Repeat protection"} step={3}>
      <BehaviourFields draft={draft} update={update} />
    </SectionCard>
  );
}

/** Re-arm / latch, timing, and the on-clear settings — a reading rule's
 * full set; an event/manual rule only has the minimum interval. */
export function BehaviourFields({ draft, update }: { draft: RuleDraft; update: Update }) {
  const reading = isReadingRule(draft);
  const clearing = canClear(draft);

  return (
    <div className="flex flex-col gap-4">
      {reading && (
        <>
          <SegmentedControl
            ariaLabel="After it fires"
            value={draft.behaviour === "latch" ? "latch" : "rearm"}
            onChange={(b) => update({ ...draft, behaviour: b })}
            options={[
              { value: "rearm", label: "Re-arm" },
              { value: "latch", label: "Latch until reset" },
            ]}
          />
          <p className="text-sm text-ink-muted">
            {draft.behaviour === "latch"
              ? "Fires once, then stays latched — even if the condition clears — until someone presses Reset on the rule."
              : "Fires, then waits for the condition to clear before it can fire again."}
          </p>
          {draft.behaviour === "other" && (
            <Callout tone="warning">
              This rule uses the “{draft.preserved.strategy}” strategy, set through the API. It&apos;s
              kept unless you pick Re-arm or Latch above.
            </Callout>
          )}
        </>
      )}
      <FieldRow wide="sm:grid-cols-2">
        {reading && (
          <NumberSafetyField
            label="Hold time (s)"
            hint="Ignore brief spikes — the condition must hold this long."
            value={draft.forDuration}
            onChange={(forDuration) => update({ ...draft, forDuration })}
            min={5}
          />
        )}
        <NumberSafetyField
          label="Minimum interval (s)"
          hint="Shortest time allowed between firings."
          value={draft.cooldown}
          onChange={(cooldown) => update({ ...draft, cooldown })}
          min={reading ? 30 : 0}
        />
      </FieldRow>
      {clearing && <ClearFields draft={draft} update={update} />}
    </div>
  );
}

function ClearFields({ draft, update }: { draft: RuleDraft; update: Update }) {
  const reverting = draft.actions.some((a) => a.kind === "actuator" && a.revertOnClear);
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <span className={SECTION_LABEL}>When the condition clears</span>
      <p className="text-sm text-ink-muted">
        Actuators set to “turn it back” above run once per firing. If a reading goes stale nothing is
        sent — the last state holds.
      </p>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="accent-accent"
          checked={draft.clearNotify}
          onChange={(e) => update({ ...draft, clearNotify: e.target.checked })}
        />
        Send a notification when it clears
      </label>
      {draft.clearNotify && (
        <Field label="Clear message">
          <Input
            compact
            value={draft.clearMessage}
            onChange={(e) => update({ ...draft, clearMessage: e.target.value })}
            placeholder="e.g. Temperature back to normal"
          />
        </Field>
      )}
      {(reverting || draft.clearNotify) && (
        <div className="max-w-xs">
          <NumberSafetyField
            label="Clear delay (s)"
            hint="The condition must stay cleared this long first — e.g. keep a light on 10s after release."
            value={draft.clearDelay}
            onChange={(clearDelay) => update({ ...draft, clearDelay })}
          />
        </div>
      )}
      {draft.preserved.clearActions.length > 0 && (
        <p className="text-sm text-ink-muted">
          Also keeps {draft.preserved.clearActions.length} clear action
          {draft.preserved.clearActions.length === 1 ? "" : "s"} set through the API.
        </p>
      )}
      {flappingRisk(draft) && (
        <Callout tone="warning">
          With no hysteresis and no clear delay, a reading hovering at the threshold switches the
          actuator on and off with every reading. Set a hysteresis on the condition or a clear delay.
        </Callout>
      )}
    </div>
  );
}

export function FormMode({ draft, catalog, update }: { draft: RuleDraft; catalog: RuleCatalog; update: Update }) {
  return (
    <>
      <SectionCard title="When" step={1}>
        <WhenFields when={draft.when} catalog={catalog} onChange={(when) => update({ ...draft, when })} />
      </SectionCard>
      <ConditionSection draft={draft} catalog={catalog} update={update} />
      <ThenSection draft={draft} catalog={catalog} update={update} />
      <BehaviourSection draft={draft} update={update} />
    </>
  );
}
