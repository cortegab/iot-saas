"use client";

import { useState, type ReactNode } from "react";
import { Bell, Globe, Mail, Plus, Power } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SwitchField } from "@/components/ui/Switch";
import { Callout } from "@/components/ui/Callout";
import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { ItemSheet } from "@/components/ui/ItemSheet";
import { LineRow, Lines } from "@/components/ui/LineRow";
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
import { ActionFields, AddActionMenu, ContactFields, NumberSafetyField, WhenFields, actionLabel } from "./fields";
import type { RuleCatalog } from "./useRuleCatalog";

type Update = (next: RuleDraft) => void;

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

/** An empty list's card (demo H): what's missing, a line of help, an action. */
function EmptyCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm">
      <b className="font-semibold text-ink">{title}</b>
      <span className="text-ink-muted">{children}</span>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** One group (demo H): "All | Any of these must be true", its conditions as
 * Line rows (nested groups indented, "and"/"or" between), then the add buttons. */
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
    onOpen(sub.children[0].id);
  };
  const word = group.op === "AND" ? "and" : "or";

  return (
    <div
      role="group"
      aria-label={`${group.op === "AND" ? "All" : "Any"} of these`}
      className={cn("flex flex-col gap-2", depth > 0 && "rounded-xl border border-dashed border-border px-3 py-3")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          ariaLabel="Combine with"
          value={group.op}
          onChange={(op) => setCondition(setGroupOp(draft.condition, group.id, op))}
          options={[
            { value: "AND", label: "All" },
            { value: "OR", label: "Any" },
          ]}
        />
        <span className="text-meta text-ink-muted">of these{depth === 0 ? " must be true" : ""}</span>
        {depth > 0 && (
          <Button type="button" variant="link-danger" className="ml-auto text-meta" onClick={() => setCondition(removeNode(draft.condition, group.id))}>
            Remove group
          </Button>
        )}
      </div>
      {group.children.map((child, i) => (
        <div key={child.id} className="flex flex-col gap-2">
          {i > 0 && (
            <span aria-hidden className="pl-3.5 text-xs font-medium uppercase tracking-[0.06em] text-ink-muted">
              {word}
            </span>
          )}
          {child.kind === "contact" ? (
            <Lines>
              <ContactRow c={child} catalog={catalog} selected={openId === child.id} onOpen={() => onOpen(child.id)} />
            </Lines>
          ) : (
            <GroupRows group={child} draft={draft} catalog={catalog} update={update} depth={depth + 1} onOpen={onOpen} openId={openId} />
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" variant="secondary" size="sm" onClick={addContact}>
          <Plus size={14} aria-hidden /> Condition
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={addGroup}>
          <Plus size={14} aria-hidden /> {other === "OR" ? "Any-of" : "All-of"} group
        </Button>
      </div>
    </div>
  );
}

function ContactRow({ c, catalog, selected, onOpen }: { c: ContactDraft; catalog: RuleCatalog; selected: boolean; onOpen: () => void }) {
  const line = contactLine(c, catalog);
  return <LineRow title={line.title} sub={line.sub} issues={contactProblem(c) ? 1 : 0} selected={selected} onOpen={onOpen} />;
}

/** If (demo H): conditions as Line rows in All / Any groups, each opening its
 * sheet. Optional for a rule that isn't started by readings. */
export function ConditionSection({ draft, catalog, update }: { draft: RuleDraft; catalog: RuleCatalog; update: Update }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const reading = isReadingRule(draft);
  const root = draft.condition;
  const device = lastDevice(draft);
  const setCondition = (condition: DraftNode | null) => update({ ...draft, condition });
  const open = openId ? findNode(root, openId) : null;
  const addFirst = () => {
    const c = emptyContact(device);
    setCondition(c);
    setOpenId(c.id);
  };

  let body;
  if (root === null) {
    body = (
      <EmptyCard
        title={reading ? "No conditions yet" : "No conditions (optional)"}
        action={
          <Button type="button" onClick={addFirst}>
            <Plus size={15} aria-hidden /> Add condition
          </Button>
        }
      >
        {reading ? "Say what has to be true for it to fire." : "It fires on its trigger. Add one to fire only when it's also true."}
      </EmptyCard>
    );
  } else if (root.kind === "contact") {
    body = (
      <>
        <Lines>
          <ContactRow c={root} catalog={catalog} selected={openId === root.id} onOpen={() => setOpenId(root.id)} />
        </Lines>
        <div className="flex flex-wrap gap-1.5">
          {(["AND", "OR"] as const).map((op) => (
            <Button
              key={op}
              type="button"
              variant={op === "AND" ? "secondary" : "ghost"}
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
    <section aria-label="If" className="flex flex-col gap-3">
      {body}
      {open && open.kind === "contact" && (
        <ItemSheet
          open
          onClose={() => setOpenId(null)}
          title="Condition"
          sub="One thing that has to be true"
          footer={
            <>
              <Button
                type="button"
                variant="link-danger"
                className="mr-auto text-meta"
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
    </section>
  );
}

const ACTION_ICON: Record<ActionDraft["kind"], typeof Power> = { actuator: Power, email: Mail, webhook: Globe, notification: Bell };

/** Then (demo H): each action a sentence on a Line row opening its sheet,
 * one Add action menu, and what happens when it clears. */
export function ThenSection({
  draft,
  catalog,
  update,
  onGoBehaviour,
}: {
  draft: RuleDraft;
  catalog: RuleCatalog;
  update: Update;
  /** "Change in Behaviour": where the clear settings live. */
  onGoBehaviour?: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const clearing = canClear(draft);
  const setActions = (actions: ActionDraft[]) => update({ ...draft, actions });
  const openIndex = draft.actions.findIndex((a) => a.id === openId);
  const open = openIndex >= 0 ? draft.actions[openIndex] : null;
  const removable = draft.actions.length > 1 || draft.preserved.actions.length > 0;
  const reverting = clearing ? draft.actions.filter((a) => a.kind === "actuator" && a.revertOnClear) : [];
  const onClear = [
    ...reverting.map((a) => {
      const t = actionLabel(a, catalog).title;
      return `${t.charAt(0).toLowerCase()}${t.slice(1)} back`;
    }),
    ...(clearing && draft.clearNotify ? ["post a notification"] : []),
  ];

  return (
    <section aria-label="Then" className="flex flex-col gap-3">
      {draft.actions.length > 0 ? (
        <Lines label="Actions">
          {draft.actions.map((action) => {
            const label = actionLabel(action, catalog);
            const Icon = ACTION_ICON[action.kind];
            const back = clearing && action.kind === "actuator" && action.revertOnClear ? " · turns back when it clears" : "";
            return (
              <LineRow
                key={action.id}
                icon={<Icon size={16} />}
                title={label.title}
                sub={label.detail + back}
                issues={actionProblem(action) ? 1 : 0}
                selected={openId === action.id}
                onOpen={() => setOpenId(action.id)}
              />
            );
          })}
        </Lines>
      ) : (
        <EmptyCard title="No actions yet">Say what happens when it fires.</EmptyCard>
      )}
      {draft.actions.length > 1 && <p className="text-meta text-ink-muted">All of them run together.</p>}
      {draft.preserved.actions.length > 0 && (
        <p className="text-sm text-ink-muted">
          Also keeps {draft.preserved.actions.length} action
          {draft.preserved.actions.length === 1 ? "" : "s"} set through the API.
        </p>
      )}
      <div>
        <AddActionMenu
          onAdd={(kind) => {
            const a = emptyAction(kind, lastDevice(draft));
            setActions([...draft.actions, a]);
            setOpenId(a.id);
          }}
        />
      </div>
      {onClear.length > 0 && (
        <p className="text-meta text-ink-muted">
          When it clears{draft.clearDelay ? ` (after ${draft.clearDelay} s)` : ""}: {onClear.join(", ")}.{" "}
          {onGoBehaviour && (
            <Button type="button" variant="link" className="text-meta" onClick={onGoBehaviour}>
              Change in Behaviour
            </Button>
          )}
        </p>
      )}
      {open && (
        <ItemSheet
          open
          onClose={() => setOpenId(null)}
          title={{ actuator: "Switch an actuator", email: "Send an email", webhook: "Call a webhook", notification: "Post a notification" }[open.kind]}
          sub="Action"
          footer={
            <>
              {removable && (
                <Button
                  type="button"
                  variant="link-danger"
                  className="mr-auto text-meta"
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
    </section>
  );
}

/** When (demo H): four cards, then what that start needs. */
export function WhenSection({ draft, catalog, update }: { draft: RuleDraft; catalog: RuleCatalog; update: Update }) {
  return (
    <section aria-label="When" className="flex flex-col gap-3">
      <WhenFields when={draft.when} catalog={catalog} onChange={(when) => update({ ...draft, when })} />
    </section>
  );
}

export function BehaviourSection({ draft, update }: { draft: RuleDraft; update: Update }) {
  return (
    <section aria-label="Behaviour" className="flex flex-col gap-3">
      <BehaviourFields draft={draft} update={update} />
    </section>
  );
}

const ILL = "h-10 w-[92px] shrink-0 self-center max-[420px]:hidden";
const REARM = (
  <svg viewBox="0 0 92 40" aria-hidden className={ILL}>
    <path d="M2 32h14v-20h14v20h18v-20h14v20h28" fill="none" stroke="var(--color-chart, var(--color-accent))" strokeWidth="1.6" />
    <circle cx="16" cy="6" r="3" fill="var(--color-accent)" />
    <circle cx="48" cy="6" r="3" fill="var(--color-accent)" />
  </svg>
);
const LATCH = (
  <svg viewBox="0 0 92 40" aria-hidden className={ILL}>
    <path d="M2 32h14v-20h14v20h18v-20h14v20h28" fill="none" stroke="var(--color-chart, var(--color-accent))" strokeWidth="1.6" />
    <circle cx="16" cy="6" r="3" fill="var(--color-accent)" />
    <path d="M16 6H90" stroke="var(--color-status-pending)" strokeWidth="1.6" strokeDasharray="3 3" />
  </svg>
);

/** Behaviour (demo H): Re-arm or Latch as illustrated cards, then the safety
 * timers three across (always applied), then what happens when it clears.
 * An event or manual rule only has the minimum interval. */
export function BehaviourFields({ draft, update }: { draft: RuleDraft; update: Update }) {
  const reading = isReadingRule(draft);
  const clearing = canClear(draft);

  return (
    <div className="@container flex flex-col gap-6">
      {reading && (
        <div className="flex flex-col gap-2">
          <span className="text-meta font-medium text-ink">After it fires</span>
          <ChoiceCards
            ariaLabel="After it fires"
            value={draft.behaviour === "latch" ? "latch" : "rearm"}
            onChange={(b) => update({ ...draft, behaviour: b })}
            options={[
              { value: "rearm", title: "Re-arm", description: "Fires again the next time the condition becomes true.", illustration: REARM },
              { value: "latch", title: "Latch until reset", description: "Fires once, then stays latched until someone resets it.", illustration: LATCH },
            ]}
          />
          {draft.behaviour === "other" && (
            <Callout tone="warning">
              This rule uses the “{draft.preserved.strategy}” strategy, set through the API. It&apos;s kept unless you pick Re-arm or Latch above.
            </Callout>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-meta font-medium text-ink">
          Safety <span className="font-normal text-ink-muted">always applied; they stop hardware flapping</span>
        </span>
        <div className="grid grid-cols-1 items-start gap-4 @min-[560px]:grid-cols-3">
          <NumberSafetyField
            label="Hold time"
            hint={reading ? "True this long before it fires." : "Only for reading rules."}
            value={draft.forDuration}
            onChange={(forDuration) => update({ ...draft, forDuration })}
            min={5}
            disabled={!reading}
          />
          <NumberSafetyField
            label="Minimum interval"
            hint="Time between two firings."
            value={draft.cooldown}
            onChange={(cooldown) => update({ ...draft, cooldown })}
            min={reading ? 30 : 0}
          />
          <NumberSafetyField
            label="Clear delay"
            hint={clearing ? "False this long before it clears." : "Only for reading rules that re-arm."}
            value={draft.clearDelay}
            onChange={(clearDelay) => update({ ...draft, clearDelay })}
            disabled={!clearing}
          />
        </div>
      </div>
      {clearing ? <ClearFields draft={draft} update={update} /> : reading && <p className="text-meta text-ink-muted">Actions on clear are for reading rules that re-arm.</p>}
    </div>
  );
}

function ClearFields({ draft, update }: { draft: RuleDraft; update: Update }) {
  return (
    <div className="flex flex-col gap-3">
      <SwitchField
        label="Notify when it clears"
        checked={draft.clearNotify}
        onChange={(clearNotify) => update({ ...draft, clearNotify })}
        onLabel="On"
        offLabel="Off"
        onHint="Posts a notification once the condition is false again."
        offHint="Nothing is posted when it clears."
      />
      {draft.clearNotify && (
        <Field label="Message">
          <Input value={draft.clearMessage} onChange={(e) => update({ ...draft, clearMessage: e.target.value })} placeholder="e.g. Temperature back to normal" />
        </Field>
      )}
      <p className="text-meta text-ink-muted">
        Actuators set to turn back (in Then) run once per firing. If a reading goes stale nothing is sent: the last state holds.
      </p>
      {draft.preserved.clearActions.length > 0 && (
        <p className="text-sm text-ink-muted">
          Also keeps {draft.preserved.clearActions.length} clear action
          {draft.preserved.clearActions.length === 1 ? "" : "s"} set through the API.
        </p>
      )}
      {flappingRisk(draft) && (
        <Callout tone="warning">
          With no hysteresis and no clear delay, a reading hovering at the threshold switches the actuator on and off with every reading. Set a
          hysteresis on the condition or a clear delay.
        </Callout>
      )}
    </div>
  );
}
