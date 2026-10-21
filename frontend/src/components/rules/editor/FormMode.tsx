"use client";

import { useState } from "react";
import { Bell, Globe, Mail, Plus, Power, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SwitchField } from "@/components/ui/Switch";
import { Callout } from "@/components/ui/Callout";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { ItemSheet } from "@/components/ui/ItemSheet";
import { LineRow } from "@/components/ui/LineRow";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { cn } from "@/lib/cn";
import {
  actionProblem,
  canClear,
  conditionFromNode,
  contactProblem,
  emptyAction,
  emptyContact,
  findNode,
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
import { conditionText } from "@/lib/rule-text";
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

/** "Any of" for OR, "All of" for AND (DESIGN.md §9.3). */
const OP_WORDS: Record<Combinator, string> = { AND: "All of", OR: "Any of" };

/** The device a newly added contact/action starts on — the last one used. */
export function lastDevice(draft: RuleDraft): string {
  const find = (node: DraftNode | null): string => {
    if (node === null) return "";
    if (node.kind === "contact") return node.deviceId;
    return find(node.children[node.children.length - 1]);
  };
  return find(draft.condition) || draft.when.statusDeviceId;
}

/** A condition on its line: "temperature > 27", then device · hysteresis. */
function contactLine(c: ContactDraft, catalog: RuleCatalog): { title: string; sub: string } {
  const text = conditionText(conditionFromNode(c));
  const device = catalog.deviceNameById[c.deviceId] ?? "Pick a device";
  return {
    title: c.metric ? text : "New condition",
    sub: [device, c.hysteresis > 0 ? `hysteresis ${c.hysteresis}` : null].filter(Boolean).join(" · "),
  };
}

/** One group's rows (DESIGN.md §9.3): its All of / Any of switch, a Line row
 * per condition, nested groups indented, and the add buttons. */
function GroupRows({
  group,
  draft,
  catalog,
  update,
  depth,
  onOpen,
  openId,
}: {
  group: GroupDraft;
  draft: RuleDraft;
  catalog: RuleCatalog;
  update: Update;
  depth: number;
  onOpen: (id: string) => void;
  openId: string | null;
}) {
  const setCondition = (condition: DraftNode | null) => update({ ...draft, condition });
  const last = group.children[group.children.length - 1];
  const device = lastDevice(draft);
  const other: Combinator = group.op === "AND" ? "OR" : "AND";
  const addContact = () => {
    const c = emptyContact(device);
    setCondition(insertBeside(draft.condition, last.id, c, group.op));
    onOpen(c.id);
  };
  const addGroup = () => {
    const sub: GroupDraft = { kind: "group", id: newId(), op: other, children: [emptyContact(device), emptyContact(device)] };
    setCondition(insertBeside(draft.condition, last.id, sub, group.op));
  };

  return (
    <div
      role="group"
      aria-label={`${OP_WORDS[group.op]} these`}
      className={cn("flex flex-col gap-2", depth > 0 && "border-l-2 border-accent-muted py-1 pl-3.5")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          ariaLabel="Combine with"
          value={group.op}
          onChange={(op) => setCondition(setGroupOp(draft.condition, group.id, op))}
          options={[
            { value: "AND", label: "All of these" },
            { value: "OR", label: "Any of these" },
          ]}
        />
        {depth > 0 && (
          <Button type="button" variant="link" className="ml-auto text-xs" onClick={() => setCondition(removeNode(draft.condition, group.id))}>
            <Trash2 size={13} aria-hidden /> Remove group
          </Button>
        )}
      </div>
      <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
        {group.children.map((child) =>
          child.kind === "contact" ? (
            <ContactRow key={child.id} c={child} catalog={catalog} selected={openId === child.id} onOpen={() => onOpen(child.id)} />
          ) : (
            <div key={child.id} className="border-t border-border-soft px-3.5 py-2.5 first:border-t-0">
              <GroupRows group={child} draft={draft} catalog={catalog} update={update} depth={depth + 1} onOpen={onOpen} openId={openId} />
            </div>
          ),
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" variant="secondary" size="sm" onClick={addContact}>
          <Plus size={14} aria-hidden /> Add condition
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={addGroup}>
          <Plus size={14} aria-hidden /> Add an {OP_WORDS[other]} group
        </Button>
      </div>
    </div>
  );
}

function ContactRow({ c, catalog, selected, onOpen }: { c: ContactDraft; catalog: RuleCatalog; selected: boolean; onOpen: () => void }) {
  const line = contactLine(c, catalog);
  return <LineRow title={line.title} sub={line.sub} issues={contactProblem(c) ? 1 : 0} selected={selected} onOpen={onOpen} />;
}

/** If (DESIGN.md §9.3): conditions as Line rows in All of / Any of groups,
 * each opening its sheet. */
export function ConditionSection({ draft, catalog, update }: { draft: RuleDraft; catalog: RuleCatalog; update: Update }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const reading = isReadingRule(draft);
  const root = draft.condition;
  const device = lastDevice(draft);
  const title = reading ? "If" : "If (optional)";
  const setCondition = (condition: DraftNode | null) => update({ ...draft, condition });
  const open = openId ? findNode(root, openId) : null;

  let body;
  if (root === null) {
    body = (
      <>
        <p className="text-sm text-ink-muted">{reading ? "Add the condition to check on each reading." : "No condition — it always runs when triggered."}</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => {
            const c = emptyContact(device);
            setCondition(c);
            setOpenId(c.id);
          }}
        >
          <Plus size={14} aria-hidden /> Add condition
        </Button>
      </>
    );
  } else if (root.kind === "contact") {
    body = (
      <>
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
          <ContactRow c={root} catalog={catalog} selected={openId === root.id} onOpen={() => setOpenId(root.id)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["AND", "OR"] as const).map((op) => (
            <Button
              key={op}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                const c = emptyContact(device);
                setCondition(insertBeside(root, root.id, c, op));
                setOpenId(c.id);
              }}
            >
              <Plus size={14} aria-hidden /> {op === "AND" ? "And" : "Or"} condition
            </Button>
          ))}
        </div>
      </>
    );
  } else {
    body = <GroupRows group={root} draft={draft} catalog={catalog} update={update} depth={0} onOpen={setOpenId} openId={openId} />;
  }

  return (
    <SectionCard id="if" title={title} step={2}>
      {body}
      {open && open.kind === "contact" && (
        <ItemSheet
          open
          onClose={() => setOpenId(null)}
          title="Condition"
          sub={contactLine(open, catalog).title}
          footer={
            <>
              <Button
                type="button"
                variant="link-danger"
                className="mr-auto text-[13px]"
                onClick={() => {
                  setCondition(removeNode(draft.condition, open.id));
                  setOpenId(null);
                }}
              >
                Remove condition
              </Button>
              <Button type="button" onClick={() => setOpenId(null)}>
                Done
              </Button>
            </>
          }
        >
          <ContactFields contact={open} catalog={catalog} onChange={(patch) => setCondition(updateContact(draft.condition, open.id, patch))} />
        </ItemSheet>
      )}
    </SectionCard>
  );
}

const ACTION_ICON: Record<ActionDraft["kind"], typeof Power> = { actuator: Power, email: Mail, webhook: Globe, notification: Bell };

/** Then (DESIGN.md §9.3): each action a Line row opening its sheet. */
export function ThenSection({ draft, catalog, update }: { draft: RuleDraft; catalog: RuleCatalog; update: Update }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const clearing = canClear(draft);
  const setActions = (actions: ActionDraft[]) => update({ ...draft, actions });
  const openIndex = draft.actions.findIndex((a) => a.id === openId);
  const open = openIndex >= 0 ? draft.actions[openIndex] : null;
  const removable = draft.actions.length > 1 || draft.preserved.actions.length > 0;

  return (
    <SectionCard
      id="then"
      title="Then"
      step={3}
      aside={draft.actions.length > 1 && <span className="text-xs text-ink-muted">All run together</span>}
    >
      {draft.actions.length > 0 && (
        <div role="group" aria-label="Actions" className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
          {draft.actions.map((action) => {
            const label = actionLabel(action, catalog);
            const Icon = ACTION_ICON[action.kind];
            return (
              <LineRow
                key={action.id}
                icon={<Icon size={16} />}
                title={label.title}
                sub={label.detail}
                issues={actionProblem(action) ? 1 : 0}
                selected={openId === action.id}
                onOpen={() => setOpenId(action.id)}
              />
            );
          })}
        </div>
      )}
      {draft.preserved.actions.length > 0 && (
        <p className="text-sm text-ink-muted">
          Also keeps {draft.preserved.actions.length} action
          {draft.preserved.actions.length === 1 ? "" : "s"} set through the API.
        </p>
      )}
      <AddActionMenu
        onAdd={(kind) => {
          const a = emptyAction(kind, lastDevice(draft));
          setActions([...draft.actions, a]);
          setOpenId(a.id);
        }}
      />
      {open && (
        <ItemSheet
          open
          onClose={() => setOpenId(null)}
          title={actionLabel(open, catalog).title}
          sub="Action"
          footer={
            <>
              {removable && (
                <Button
                  type="button"
                  variant="link-danger"
                  className="mr-auto text-[13px]"
                  onClick={() => {
                    setActions(draft.actions.filter((a) => a.id !== open.id));
                    setOpenId(null);
                  }}
                >
                  Remove action
                </Button>
              )}
              <Button type="button" onClick={() => setOpenId(null)}>
                Done
              </Button>
            </>
          }
        >
          <ActionFields
            action={open}
            catalog={catalog}
            clearing={clearing}
            onChange={(next) => setActions(draft.actions.map((a, j) => (j === openIndex ? next : a)))}
          />
        </ItemSheet>
      )}
    </SectionCard>
  );
}

/** When: the trigger. */
export function WhenSection({ draft, catalog, update }: { draft: RuleDraft; catalog: RuleCatalog; update: Update }) {
  return (
    <SectionCard id="when" title="When" step={1}>
      <WhenFields when={draft.when} catalog={catalog} onChange={(when) => update({ ...draft, when })} />
    </SectionCard>
  );
}

export function BehaviourSection({ draft, update }: { draft: RuleDraft; update: Update }) {
  return (
    <SectionCard id="behaviour" title={isReadingRule(draft) ? "Behaviour" : "Repeat protection"} step={4}>
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
      <SwitchField
        label="Send a notification when it clears"
        checked={draft.clearNotify}
        onChange={(clearNotify) => update({ ...draft, clearNotify })}
        onLabel="On"
        offLabel="Off"
        onHint="Posts the message below to Notifications."
      />
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

