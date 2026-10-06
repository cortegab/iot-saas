"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ancestry } from "@/lib/ladder-layout";
import {
  canClear,
  emptyAction,
  emptyContact,
  findNode,
  insertBeside,
  removeNode,
  setGroupOp,
  updateContact,
  type Combinator,
  type DraftNode,
  type RuleDraft,
} from "@/lib/rule-draft";
import { BehaviourFields, lastDevice } from "@/components/rules/editor/FormMode";
import { ActionFields, AddActionMenu, CompactFields, ContactFields, WhenFields, actionLabel } from "@/components/rules/editor/fields";
import type { RuleCatalog } from "@/components/rules/editor/useRuleCatalog";
import { LadderRung, type LadderSelection } from "./LadderRung";

type Update = (next: RuleDraft) => void;

const BLOCK_HINT: Record<Combinator, string> = {
  AND: "Series: every element must be true (AND).",
  OR: "Parallel: any one branch is enough (OR).",
};

/** "Rung › Series › Parallel" — the blocks enclosing an element (demo G's
 * inspector breadcrumb); each enclosing block is a button that selects it. */
function Crumb({ draft, id, leaf, select }: { draft: RuleDraft; id?: string; leaf?: string; select: (s: LadderSelection) => void }) {
  const self = id ? findNode(draft.condition, id) : null;
  const blocks = (id ? ancestry(draft.condition, id) : []).filter((p) => p.kind === "group" && p.id !== id);
  const word = (n: DraftNode) => (n.kind === "group" && n.op === "OR" ? "Parallel" : "Series");
  return (
    <nav aria-label="Where this sits" className="flex flex-wrap items-center gap-1 font-mono text-[12px] text-ink-muted">
      <button type="button" onClick={() => select(null)} className="hover:text-ink">
        Rung
      </button>
      {blocks.map((b) => (
        <span key={b.id} className="flex items-center gap-1">
          <span aria-hidden>›</span>
          <button type="button" onClick={() => select({ kind: "node", id: b.id })} className="hover:text-ink">
            {word(b)}
          </button>
        </span>
      ))}
      {self?.kind === "group" && (
        <span className="flex items-center gap-1">
          <span aria-hidden>›</span>
          <span className="text-ink">{word(self)}</span>
        </span>
      )}
      {leaf && (
        <span className="flex items-center gap-1">
          <span aria-hidden>›</span>
          <span className="text-ink">{leaf}</span>
        </span>
      )}
    </nav>
  );
}

function Title({ children }: { children: string }) {
  return <h3 className="text-[15px] font-semibold text-ink">{children}</h3>;
}

function InspectorBody({
  selection,
  draft,
  catalog,
  update,
  select,
}: {
  selection: LadderSelection;
  draft: RuleDraft;
  catalog: RuleCatalog;
  update: Update;
  select: (s: LadderSelection) => void;
}) {
  const setCondition = (condition: DraftNode | null) => update({ ...draft, condition });

  if (selection === null) {
    return (
      <>
        <Title>Rule</Title>
        <p className="text-[13px] text-ink-muted">
          Select the trigger, a contact, a block, the timer or a coil on the rung to edit it. Use <strong>+</strong> to add a contact at the end or another coil.
        </p>
      </>
    );
  }
  if (selection.kind === "when") {
    return (
      <>
        <Crumb draft={draft} leaf="Trigger" select={select} />
        <Title>Trigger</Title>
        <WhenFields when={draft.when} catalog={catalog} onChange={(when) => update({ ...draft, when })} />
      </>
    );
  }
  if (selection.kind === "timing") {
    return (
      <>
        <Crumb draft={draft} leaf="Timer" select={select} />
        <Title>Behaviour</Title>
        <BehaviourFields draft={draft} update={update} />
      </>
    );
  }
  if (selection.kind === "add-action") {
    return (
      <>
        <Crumb draft={draft} leaf="Coil" select={select} />
        <Title>New coil</Title>
        <p className="text-[13px] text-ink-muted">It runs together with the other coils when the rule fires.</p>
        <AddActionMenu
          onAdd={(kind) => {
            const action = emptyAction(kind, lastDevice(draft));
            update({ ...draft, actions: [...draft.actions, action] });
            select({ kind: "action", id: action.id });
          }}
        />
      </>
    );
  }
  if (selection.kind === "node") {
    const id = selection.id;
    const node = findNode(draft.condition, id);
    if (!node) return null;
    const add = (op: Combinator) => {
      const fresh = emptyContact(lastDevice(draft));
      setCondition(insertBeside(draft.condition, id, fresh, op));
      select({ kind: "node", id: fresh.id });
    };
    const remove = () => {
      setCondition(removeNode(draft.condition, id));
      select(null);
    };
    const addButtons = (
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" size="sm" variant="secondary" onClick={() => add("AND")}>
          Add in series
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => add("OR")}>
          Add in parallel
        </Button>
      </div>
    );
    if (node.kind === "contact") {
      return (
        <>
          <Crumb draft={draft} id={id} leaf="Contact" select={select} />
          <Title>Contact</Title>
          <ContactFields contact={node} catalog={catalog} onChange={(patch) => setCondition(updateContact(draft.condition, id, patch))} />
          {addButtons}
          <div>
            <Button type="button" size="sm" variant="link-danger" onClick={remove}>
              <Trash2 size={13} aria-hidden /> Remove
            </Button>
          </div>
        </>
      );
    }
    return (
      <>
        <Crumb draft={draft} id={id} select={select} />
        <Title>{node.op === "AND" ? "Series block" : "Parallel block"}</Title>
        <SegmentedControl
          ariaLabel="Block type"
          value={node.op}
          onChange={(op) => setCondition(setGroupOp(draft.condition, id, op))}
          options={[
            { value: "AND", label: "Series: all true" },
            { value: "OR", label: "Parallel: any true" },
          ]}
        />
        <p className="text-[13px] text-ink-muted">
          {BLOCK_HINT[node.op]} {node.children.length} elements; changing the type keeps every contact.
        </p>
        {addButtons}
        {node.id !== draft.condition?.id && (
          <div>
            <Button type="button" size="sm" variant="link-danger" onClick={remove}>
              <Trash2 size={13} aria-hidden /> Remove block
            </Button>
          </div>
        )}
      </>
    );
  }
  const index = draft.actions.findIndex((a) => a.id === selection.id);
  const action = draft.actions[index];
  if (!action) return null;
  const canRemove = draft.actions.length > 1 || draft.preserved.actions.length > 0;
  return (
    <>
      <Crumb draft={draft} leaf="Coil" select={select} />
      <Title>{actionLabel(action, catalog).title}</Title>
      <ActionFields
        action={action}
        catalog={catalog}
        clearing={canClear(draft)}
        onChange={(next) => update({ ...draft, actions: draft.actions.map((a, j) => (j === index ? next : a)) })}
      />
      <div>
        <Button
          type="button"
          size="sm"
          variant="link-danger"
          disabled={!canRemove}
          onClick={() => {
            update({ ...draft, actions: draft.actions.filter((_, j) => j !== index) });
            select(null);
          }}
        >
          <Trash2 size={13} aria-hidden /> Remove coil
        </Button>
      </div>
    </>
  );
}

const LEGEND: { glyph: string; text: string }[] = [
  { glyph: "[ ]", text: "condition (contact)" },
  { glyph: "[/]", text: "on/off input is OFF" },
  { glyph: "( )", text: "actuator, turns back when cleared" },
  { glyph: "(P)", text: "actuator, set only" },
  { glyph: "(S)", text: "latched until reset" },
];

/** Ladder view (DESIGN.md §9, demo G): the rung on the left and the
 * selected element's properties in an inspector on the right. */
export function LadderMode({ draft, catalog, update }: { draft: RuleDraft; catalog: RuleCatalog; update: Update }) {
  const [selection, setSelection] = useState<LadderSelection>(null);

  // A selection whose target was just removed (e.g. via undoing in form mode)
  // falls back to "nothing selected" instead of an empty inspector.
  const live =
    selection?.kind === "node"
      ? findNode(draft.condition, selection.id)
        ? selection
        : null
      : selection?.kind === "action"
        ? draft.actions.some((a) => a.id === selection.id)
          ? selection
          : null
        : selection;

  function addSeriesAtEnd() {
    const fresh = emptyContact(lastDevice(draft));
    const root = draft.condition;
    update({ ...draft, condition: root === null ? fresh : insertBeside(root, root.id, fresh, "AND") });
    setSelection({ kind: "node", id: fresh.id });
  }

  return (
    <div className="grid items-start gap-x-4 gap-y-3 lg:grid-cols-[minmax(0,1fr)_310px]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="overflow-x-auto rounded-xl border border-border bg-surface bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] p-4 shadow-card [background-size:14px_14px]">
          <LadderRung draft={draft} catalog={catalog} selection={live} onSelect={setSelection} onAddSeriesAtEnd={addSeriesAtEnd} ariaLabel="Rule rung editor" />
        </div>
        <p className="text-[13px] text-ink-muted">
          Series contacts must all be true; parallel branches need any one. Select an element to edit it. The ladder and the form edit the same rule.
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          {LEGEND.map((l) => (
            <li key={l.glyph}>
              <span className="font-mono text-ink">{l.glyph}</span> {l.text}
            </li>
          ))}
        </ul>
      </div>
      {/* A 310px panel: every field takes its own row, as in demo G. */}
      <aside aria-label="Inspector" className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-canvas p-4 lg:sticky lg:top-4">
        <CompactFields.Provider value={true}>
          <InspectorBody selection={live} draft={draft} catalog={catalog} update={update} select={setSelection} />
        </CompactFields.Provider>
      </aside>
    </div>
  );
}
