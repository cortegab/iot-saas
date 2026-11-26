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
  behaviourSentence,
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
import { useRuleCatalog, type RuleCatalog } from "./useRuleCatalog";
import { useInterfaceMode } from "@/hooks/useInterfaceMode";
import { tActive as tr } from "@iodriven/shared/i18n";

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
  const device = catalog.deviceNameById[c.deviceId] ?? tr("editor.form.pickDevice");
  return {
    title: c.metric ? text : tr("editor.form.newCondition"),
    sub: [device, c.hysteresis > 0 ? tr("editor.form.hysteresisN", { n: String(c.hysteresis) }) : null].filter(Boolean).join(" · "),
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
      aria-label={tr(group.op === "AND" ? "editor.form.allOf" : "editor.form.anyOf")}
      className={cn("flex flex-col gap-2", depth > 0 && "rounded-xl border border-dashed border-border px-3 py-3")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          ariaLabel={tr("editor.form.combineWith")}
          value={group.op}
          onChange={(op) => setCondition(setGroupOp(draft.condition, group.id, op))}
          options={[
            { value: "AND", label: tr("editor.form.all") },
            { value: "OR", label: tr("editor.form.any") },
          ]}
        />
        <span className="text-meta text-ink-muted">of these{depth === 0 ? " must be true" : ""}</span>
        {depth > 0 && (
          <Button type="button" variant="link-danger" className="ml-auto text-meta" onClick={() => setCondition(removeNode(draft.condition, group.id))}>
            {tr("editor.form.removeGroup")}
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
          <Plus size={14} aria-hidden /> {tr(other === "OR" ? "editor.form.anyGroup" : "editor.form.allGroup")}
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
        title={reading ? tr("editor.form.noConditions") : tr("editor.form.noConditionsOptional")}
        action={
          <Button type="button" onClick={addFirst}>
            <Plus size={15} aria-hidden /> Add condition
          </Button>
        }
      >
        {reading ? tr("editor.form.sayTrue") : tr("editor.form.firesOnTrigger")}
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
              <Plus size={14} aria-hidden /> {tr(op === "AND" ? "editor.form.andCondition" : "editor.form.orCondition")}
            </Button>
          ))}
        </div>
      </>
    );
  } else {
    body = <GroupRows group={root} draft={draft} catalog={catalog} update={update} depth={0} onOpen={setOpenId} openId={openId} />;
  }

  return (
    <section aria-label={tr("editor.form.if")} className="flex flex-col gap-3">
      {body}
      {open && open.kind === "contact" && (
        <ItemSheet
          open
          onClose={() => setOpenId(null)}
          title={tr("editor.form.condition")}
          sub={tr("editor.form.conditionSub")}
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
                {tr("editor.form.removeCondition")}
              </Button>
              <Button type="button" onClick={() => setOpenId(null)}>
                {tr("editor.form.done")}
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
    <section aria-label={tr("editor.form.then")} className="flex flex-col gap-3">
      {draft.actions.length > 0 ? (
        <Lines label={tr("editor.form.actions")}>
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
        <EmptyCard title={tr("editor.form.noActions")}>{tr("editor.form.noActionsBody")}</EmptyCard>
      )}
      {draft.actions.length > 1 && <p className="text-meta text-ink-muted">{tr("editor.form.allTogether")}</p>}
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
          {draft.clearDelay
            ? tr("editor.form.whenClearsAfter", { n: String(draft.clearDelay), list: onClear.join(", ") })
            : tr("editor.form.whenClears", { list: onClear.join(", ") })}{" "}
          {onGoBehaviour && (
            <Button type="button" variant="link" className="text-meta" onClick={onGoBehaviour}>
              {tr("editor.form.changeInBehaviour")}
            </Button>
          )}
        </p>
      )}
      {open && (
        <ItemSheet
          open
          onClose={() => setOpenId(null)}
          title={{ actuator: tr("editor.switchActuator"), email: tr("editor.sendEmail"), webhook: tr("editor.callWebhook"), notification: tr("editor.postNotification") }[open.kind]}
          sub={tr("editor.form.action")}
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
                  {tr("editor.form.removeAction")}
                </Button>
              )}
              <Button type="button" onClick={() => setOpenId(null)}>
                {tr("editor.form.done")}
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
    <section aria-label={tr("editor.form.when")} className="flex flex-col gap-3">
      <WhenFields when={draft.when} catalog={catalog} onChange={(when) => update({ ...draft, when })} />
    </section>
  );
}

export function BehaviourSection({ draft, update }: { draft: RuleDraft; update: Update }) {
  return (
    <section aria-label={tr("editor.form.behaviour")} className="flex flex-col gap-3">
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
 * The wording follows what it acts on: relays flap, alerts repeat. An event
 * or manual rule only has the minimum interval (in Then, IntervalField). */
export function BehaviourFields({ draft, update }: { draft: RuleDraft; update: Update }) {
  const reading = isReadingRule(draft);
  const clearing = canClear(draft);
  const hardware = switchesHardware(draft);
  const catalog = useRuleCatalog();
  // Simple view (DESIGN.md §15a): the sentence, the numbers one click away.
  const { simple } = useInterfaceMode();
  const fields = <BehaviourFieldsBody draft={draft} update={update} reading={reading} clearing={clearing} hardware={hardware} />;

  return (
    <div className="@container flex flex-col gap-6">
      {/* The numbers below, said once by what they do (ease-of-use C4). */}
      <p className="text-sm text-ink">{behaviourSentence(draft, (c) => catalog.metricFor(c.deviceId, c.metric)?.unit)}</p>
      {simple ? (
        <details className="overflow-hidden rounded-lg border border-border">
          <summary className="cursor-pointer bg-surface-raised px-3 py-2 text-meta text-ink">{tr("editor.form.changeTimings")}</summary>
          <div className="flex flex-col gap-6 p-4">{fields}</div>
        </details>
      ) : (
        fields
      )}
    </div>
  );
}

function BehaviourFieldsBody({ draft, update, reading, clearing, hardware }: { draft: RuleDraft; update: Update; reading: boolean; clearing: boolean; hardware: boolean }) {
  return (
    <>
      {reading && (
        <div className="flex flex-col gap-2">
          <span className="text-meta font-medium text-ink">{tr("editor.form.afterFires")}</span>
          <ChoiceCards
            ariaLabel={tr("editor.form.afterFires")}
            value={draft.behaviour === "latch" ? "latch" : "rearm"}
            onChange={(b) => update({ ...draft, behaviour: b })}
            options={[
              { value: "rearm", title: tr("editor.form.rearm"), description: tr("editor.form.rearmHint"), illustration: REARM },
              { value: "latch", title: tr("editor.form.latch"), description: tr("editor.form.latchHint"), illustration: LATCH },
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
          {tr("editor.form.safety")} <span className="font-normal text-ink-muted">{tr(hardware ? "editor.form.safetyHardware" : "editor.form.safetyAlerts")}</span>
        </span>
        <div className="grid grid-cols-1 items-start gap-4 @min-[560px]:grid-cols-3">
          <NumberSafetyField
            label={tr("editor.form.holdTime")}
            hint={reading ? tr("editor.form.holdHint") : tr("editor.form.onlyReading")}
            value={draft.forDuration}
            onChange={(forDuration) => update({ ...draft, forDuration })}
            min={5}
            disabled={!reading}
            hardware={hardware}
          />
          <NumberSafetyField
            label={tr("editor.form.minInterval")}
            hint={tr("editor.form.minIntervalHint")}
            value={draft.cooldown}
            onChange={(cooldown) => update({ ...draft, cooldown })}
            min={reading ? 30 : 0}
            hardware={hardware}
          />
          <NumberSafetyField
            label={tr("editor.form.clearDelay")}
            hint={clearing ? tr("editor.form.clearDelayHint") : tr("editor.form.clearOnlyRearm")}
            value={draft.clearDelay}
            onChange={(clearDelay) => update({ ...draft, clearDelay })}
            disabled={!clearing}
          />
        </div>
      </div>
      {clearing ? <ClearFields draft={draft} update={update} /> : reading && <p className="text-meta text-ink-muted">{tr("editor.form.clearActionsNote")}</p>}
    </>
  );
}

/** A rule not on a reading (schedule, manual, online / offline) has one
 * timer, so it sits under Then instead of a Behaviour tab of its own. */
export function IntervalField({ draft, update, hardware }: { draft: RuleDraft; update: Update; hardware: boolean }) {
  return (
    <div className="max-w-[260px]">
      <NumberSafetyField
        label={tr("editor.form.minInterval")}
        hint={hardware ? tr("editor.form.intervalHardware") : tr("editor.form.intervalAlerts")}
        value={draft.cooldown}
        onChange={(cooldown) => update({ ...draft, cooldown })}
        hardware={hardware}
      />
    </div>
  );
}

const switchesHardware = (draft: RuleDraft) => draft.actions.some((a) => a.kind === "actuator");

function ClearFields({ draft, update }: { draft: RuleDraft; update: Update }) {
  return (
    <div className="flex flex-col gap-3">
      <SwitchField
        label={tr("editor.form.notifyClear")}
        checked={draft.clearNotify}
        onChange={(clearNotify) => update({ ...draft, clearNotify })}
        onLabel={tr("editor.on")}
        offLabel={tr("editor.off")}
        onHint={tr("editor.form.notifyClearOn")}
        offHint={tr("editor.form.notifyClearOff")}
      />
      {draft.clearNotify && (
        <Field label={tr("editor.message")}>
          <Input value={draft.clearMessage} onChange={(e) => update({ ...draft, clearMessage: e.target.value })} placeholder="e.g. Temperature back to normal" />
        </Field>
      )}
      {switchesHardware(draft) && (
        <p className="text-meta text-ink-muted">
          {tr("editor.form.turnBackNote")}
        </p>
      )}
      {draft.preserved.clearActions.length > 0 && (
        <p className="text-sm text-ink-muted">
          Also keeps {draft.preserved.clearActions.length} clear action
          {draft.preserved.clearActions.length === 1 ? "" : "s"} set through the API.
        </p>
      )}
      {flappingRisk(draft) && (
        <Callout tone="warning">
          With nothing to smooth it, a reading that flips back and forth (a value hovering at the threshold, or a button that bounces) switches the
          actuator on and off with every reading. Set a hysteresis on the condition, a hold time, or a clear delay.
        </Callout>
      )}
    </div>
  );
}
