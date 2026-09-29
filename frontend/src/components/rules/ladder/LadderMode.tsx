"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
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
import {
  ActionFields,
  AddActionMenu,
  ContactFields,
  SECTION_LABEL,
  WhenFields,
  actionLabel,
} from "@/components/rules/editor/fields";
import type { RuleCatalog } from "@/components/rules/editor/useRuleCatalog";
import { LadderRung, type LadderSelection } from "./LadderRung";

type Update = (next: RuleDraft) => void;

const BLOCK_WORDS: Record<Combinator, string> = {
  AND: "Series block — all must be true (AND)",
  OR: "Parallel block — any can be true (OR)",
};

function nodeCrumb(node: DraftNode): string {
  return node.kind === "contact" ? "Contact" : node.op === "AND" ? "Series" : "Parallel";
}

function NodeInspector({
  id,
  draft,
  catalog,
  update,
  select,
}: {
  id: string;
  draft: RuleDraft;
  catalog: RuleCatalog;
  update: Update;
  select: (s: LadderSelection) => void;
}) {
  const node = findNode(draft.condition, id);
  if (!node) return null;
  const path = ancestry(draft.condition, id);
  const setCondition = (condition: DraftNode | null) => update({ ...draft, condition });

  function add(op: Combinator) {
    const fresh = emptyContact(lastDevice(draft));
    setCondition(insertBeside(draft.condition, id, fresh, op));
    select({ kind: "node", id: fresh.id });
  }

  return (
    <div className="flex flex-col gap-4">
      {path.length > 1 && (
        <nav aria-label="Enclosing blocks" className="flex flex-wrap items-center gap-1 text-xs">
          {path.map((p, i) => (
            <span key={p.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-ink-muted">›</span>}
              <button
                type="button"
                onClick={() => select({ kind: "node", id: p.id })}
                aria-current={p.id === id ? "true" : undefined}
                className={
                  p.id === id
                    ? "rounded bg-accent-muted px-1.5 py-0.5 font-medium text-accent"
                    : "rounded px-1.5 py-0.5 text-ink-muted hover:text-ink"
                }
              >
                {nodeCrumb(p)}
              </button>
            </span>
          ))}
        </nav>
      )}

      {node.kind === "contact" ? (
        <ContactFields
          contact={node}
          catalog={catalog}
          onChange={(patch) => setCondition(updateContact(draft.condition, id, patch))}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-sm text-ink">{BLOCK_WORDS[node.op]}</span>
          <SegmentedControl
            ariaLabel="Block type"
            value={node.op}
            onChange={(op) => setCondition(setGroupOp(draft.condition, id, op))}
            options={[
              { value: "AND", label: "Series (AND)" },
              { value: "OR", label: "Parallel (OR)" },
            ]}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
        <Button type="button" variant="secondary" onClick={() => add("AND")}>
          + In series (AND) after this
        </Button>
        <Button type="button" variant="secondary" onClick={() => add("OR")}>
          + In parallel (OR) below this
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="ml-auto text-xs"
          onClick={() => {
            setCondition(removeNode(draft.condition, id));
            select(null);
          }}
        >
          <Trash2 size={13} aria-hidden /> Remove {node.kind === "contact" ? "contact" : "block"}
        </Button>
      </div>
    </div>
  );
}

function Inspector({
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
  if (selection === null) {
    return (
      <p className="text-sm text-ink-muted">
        Select anything on the rung to edit it — the trigger on the rail, a contact, the hold timer,
        or an action coil. Use <strong>+</strong> to add a contact at the end or another action.
      </p>
    );
  }
  if (selection.kind === "when") {
    return <WhenFields when={draft.when} catalog={catalog} onChange={(when) => update({ ...draft, when })} />;
  }
  if (selection.kind === "timing") {
    return <BehaviourFields draft={draft} update={update} />;
  }
  if (selection.kind === "node") {
    return <NodeInspector id={selection.id} draft={draft} catalog={catalog} update={update} select={select} />;
  }
  if (selection.kind === "add-action") {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm text-ink">Add an action — it runs in parallel with the others.</span>
        <AddActionMenu
          onAdd={(kind) => {
            const action = emptyAction(kind, lastDevice(draft));
            update({ ...draft, actions: [...draft.actions, action] });
            select({ kind: "action", id: action.id });
          }}
        />
      </div>
    );
  }
  const index = draft.actions.findIndex((a) => a.id === selection.id);
  const action = draft.actions[index];
  if (!action) return null;
  const canRemove = draft.actions.length > 1 || draft.preserved.actions.length > 0;
  return (
    <div className="flex flex-col gap-4">
      <ActionFields
        action={action}
        catalog={catalog}
        clearing={canClear(draft)}
        onChange={(next) => update({ ...draft, actions: draft.actions.map((a, j) => (j === index ? next : a)) })}
      />
      <div className="flex border-t border-border pt-3">
        <Button
          type="button"
          variant="ghost"
          className="ml-auto text-xs"
          disabled={!canRemove}
          onClick={() => {
            update({ ...draft, actions: draft.actions.filter((_, j) => j !== index) });
            select(null);
          }}
        >
          <Trash2 size={13} aria-hidden /> Remove action
        </Button>
      </div>
    </div>
  );
}

function inspectorTitle(selection: LadderSelection, draft: RuleDraft, catalog: RuleCatalog): string {
  if (selection === null) return "Inspector";
  if (selection.kind === "when") return "When";
  if (selection.kind === "timing") return "Behaviour & timing";
  if (selection.kind === "add-action") return "New action";
  if (selection.kind === "node") {
    const node = findNode(draft.condition, selection.id);
    return node?.kind === "group" ? "Block" : "Contact";
  }
  const action = draft.actions.find((a) => a.id === selection.id);
  return action ? `Action · ${actionLabel(action, catalog).title}` : "Action";
}

const LEGEND: { glyph: string; text: string }[] = [
  { glyph: "[ ]", text: "condition (contact)" },
  { glyph: "[/]", text: "on/off input is OFF" },
  { glyph: "( )", text: "actuator, turns back when cleared" },
  { glyph: "(P)", text: "actuator, set only" },
  { glyph: "(S)", text: "latched until reset" },
];

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
    <>
      <Card padding="md">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={SECTION_LABEL}>Rung</h2>
            <Button type="button" variant="ghost" className="ml-auto text-xs" onClick={() => setSelection({ kind: "when" })}>
              When…
            </Button>
            <Button type="button" variant="ghost" className="text-xs" onClick={() => setSelection({ kind: "timing" })}>
              Behaviour & timing…
            </Button>
          </div>
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <LadderRung
              draft={draft}
              catalog={catalog}
              selection={live}
              onSelect={setSelection}
              onAddSeriesAtEnd={addSeriesAtEnd}
              ariaLabel="Rule rung editor"
            />
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
            {LEGEND.map((l) => (
              <li key={l.glyph}>
                <span className="font-mono text-ink">{l.glyph}</span> {l.text}
              </li>
            ))}
          </ul>
        </div>
      </Card>
      <Card padding="md">
        <div className="flex flex-col gap-4">
          <h2 className={SECTION_LABEL}>{inspectorTitle(live, draft, catalog)}</h2>
          <Inspector selection={live} draft={draft} catalog={catalog} update={update} select={setSelection} />
        </div>
      </Card>
    </>
  );
}
