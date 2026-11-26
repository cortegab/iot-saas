"use client";

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
import { ActionFields, AddActionMenu, ContactFields, WhenFields, actionLabel } from "@/components/rules/editor/fields";
import type { RuleCatalog } from "@/components/rules/editor/useRuleCatalog";
import { ItemSheet } from "@/components/ui/ItemSheet";
import { ResponsiveRung, type LadderSelection } from "./LadderRung";
import { tActive as tr } from "@iodriven/shared/i18n";
import { richT } from "@/lib/i18n";

type Update = (next: RuleDraft) => void;

const BLOCK_HINT: Record<Combinator, string> = {
  get AND() { return tr("ladder.blockAnd"); },
  get OR() { return tr("ladder.blockOr"); },
};

/** "Rung › Series › Parallel" — the blocks enclosing an element (demo G's
 * inspector breadcrumb); each enclosing block is a button that selects it. */
function Crumb({ draft, id, leaf, select }: { draft: RuleDraft; id?: string; leaf?: string; select: (s: LadderSelection) => void }) {
  const self = id ? findNode(draft.condition, id) : null;
  const blocks = (id ? ancestry(draft.condition, id) : []).filter((p) => p.kind === "group" && p.id !== id);
  const word = (n: DraftNode) => (n.kind === "group" && n.op === "OR" ? tr("ladder.parallel") : tr("ladder.series"));
  return (
    <nav aria-label={tr("ladder.whereSits")} className="flex flex-wrap items-center gap-1 font-mono text-xs text-ink-muted">
      <button type="button" onClick={() => select(null)} className="hover:text-ink">
        {tr("ladder.rung")}
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

function Title({ children, show = true }: { children: string; show?: boolean }) {
  return show ? <h3 className="text-section font-semibold text-ink">{children}</h3> : null;
}

function InspectorBody({
  selection,
  draft,
  catalog,
  update,
  select,
  titled = true,
}: {
  selection: LadderSelection;
  draft: RuleDraft;
  catalog: RuleCatalog;
  update: Update;
  select: (s: LadderSelection) => void;
  /** False inside a sheet, whose header already names it. */
  titled?: boolean;
}) {
  const setCondition = (condition: DraftNode | null) => update({ ...draft, condition });

  if (selection === null) {
    return (
      <>
        <Title show={titled}>{tr("ladder.rule")}</Title>
        <p className="text-meta text-ink-muted">
          {richT(tr, "ladder.ruleLead", { plus: <strong>+</strong> })}
        </p>
      </>
    );
  }
  if (selection.kind === "when") {
    return (
      <>
        <Crumb draft={draft} leaf={tr("ladder.trigger")} select={select} />
        <Title show={titled}>{tr("ladder.trigger")}</Title>
        <WhenFields when={draft.when} catalog={catalog} onChange={(when) => update({ ...draft, when })} />
      </>
    );
  }
  if (selection.kind === "timing") {
    return (
      <>
        <Crumb draft={draft} leaf={tr("ladder.timer")} select={select} />
        <Title show={titled}>{tr("ladder.behaviour")}</Title>
        <BehaviourFields draft={draft} update={update} />
      </>
    );
  }
  if (selection.kind === "add-action") {
    return (
      <>
        <Crumb draft={draft} leaf={tr("ladder.coil")} select={select} />
        <Title show={titled}>{tr("ladder.newCoil")}</Title>
        <p className="text-meta text-ink-muted">{tr("ladder.newCoilLead")}</p>
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
          {tr("ladder.addSeries")}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => add("OR")}>
          {tr("ladder.addParallel")}
        </Button>
      </div>
    );
    if (node.kind === "contact") {
      return (
        <>
          <Crumb draft={draft} id={id} leaf={tr("ladder.contact")} select={select} />
          <Title show={titled}>{tr("ladder.contact")}</Title>
          <ContactFields contact={node} catalog={catalog} onChange={(patch) => setCondition(updateContact(draft.condition, id, patch))} />
          {addButtons}
          <div>
            <Button type="button" size="sm" variant="link-danger" onClick={remove}>
              <Trash2 size={13} aria-hidden /> {tr("ladder.remove")}
            </Button>
          </div>
        </>
      );
    }
    return (
      <>
        <Crumb draft={draft} id={id} select={select} />
        <Title show={titled}>{node.op === "AND" ? tr("ladder.seriesBlock") : tr("ladder.parallelBlock")}</Title>
        <SegmentedControl
          ariaLabel={tr("ladder.blockType")}
          value={node.op}
          onChange={(op) => setCondition(setGroupOp(draft.condition, id, op))}
          options={[
            { value: "AND", label: tr("ladder.seriesAll") },
            { value: "OR", label: tr("ladder.parallelAny") },
          ]}
        />
        <p className="text-meta text-ink-muted">
          {BLOCK_HINT[node.op]} {tr("ladder.elements", { count: node.children.length })}
        </p>
        {addButtons}
        {node.id !== draft.condition?.id && (
          <div>
            <Button type="button" size="sm" variant="link-danger" onClick={remove}>
              <Trash2 size={13} aria-hidden /> {tr("ladder.removeBlock")}
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
      <Crumb draft={draft} leaf={tr("ladder.coil")} select={select} />
      <Title show={titled}>{actionLabel(action, catalog).title}</Title>
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
          <Trash2 size={13} aria-hidden /> {tr("ladder.removeCoil")}
        </Button>
      </div>
    </>
  );
}

const LEGEND: { glyph: string; text: string }[] = [
  { glyph: "[ ]", get text() { return tr("ladder.legendContact"); } },
  { glyph: "[/]", get text() { return tr("ladder.legendNc"); } },
  { glyph: "( )", get text() { return tr("ladder.legendRevert"); } },
  { glyph: "(P)", get text() { return tr("ladder.legendPulse"); } },
  { glyph: "(S)", get text() { return tr("ladder.legendLatch"); } },
];

/** What the rule editor has selected: a rung element, or the rule itself
 * (name and status, which has no element on the rung). */
export type EditorSelection = LadderSelection | { kind: "name" };

/** A selection whose target was just removed (e.g. deleted in Form) falls
 * back to "nothing selected" instead of an empty inspector. */
export function liveSelection(draft: RuleDraft, selection: EditorSelection): EditorSelection {
  if (selection?.kind === "node") return findNode(draft.condition, selection.id) ? selection : null;
  if (selection?.kind === "action") return draft.actions.some((a) => a.id === selection.id) ? selection : null;
  return selection;
}

/** The rung, its hint and legend (DESIGN.md §9.10) — the Ladder canvas.
 * Horizontal when it fits, vertical otherwise; arrow keys move between its
 * elements and Enter opens one. */
export function LadderCanvas({
  draft,
  catalog,
  update,
  selection,
  onSelect,
}: {
  draft: RuleDraft;
  catalog: RuleCatalog;
  update: Update;
  selection: EditorSelection;
  onSelect: (s: EditorSelection) => void;
}) {
  function addSeriesAtEnd() {
    const fresh = emptyContact(lastDevice(draft));
    const root = draft.condition;
    update({ ...draft, condition: root === null ? fresh : insertBeside(root, root.id, fresh, "AND") });
    onSelect({ kind: "node", id: fresh.id });
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="overflow-hidden rounded-xl border border-border bg-surface bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] p-4 shadow-card [background-size:14px_14px]">
        <ResponsiveRung
          draft={draft}
          catalog={catalog}
          selection={selection?.kind === "name" ? null : selection}
          onSelect={onSelect}
          onAddSeriesAtEnd={addSeriesAtEnd}
          ariaLabel={tr("ladder.editorAria")}
        />
      </div>
      <p className="text-meta text-ink-muted">
        {tr("ladder.help")}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {LEGEND.map((l) => (
          <li key={l.glyph}>
            <span className="font-mono text-ink">{l.glyph}</span> {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The selected contact, block or coil in an item sheet (DESIGN.md §9.10:
 * the same sheets as the Form; there is no inspector column). The trigger
 * and the timers open their tabs instead, so this only shows for those. */
export function LadderSheet({
  draft,
  catalog,
  update,
  selection,
  onSelect,
}: {
  draft: RuleDraft;
  catalog: RuleCatalog;
  update: Update;
  selection: EditorSelection;
  onSelect: (s: EditorSelection) => void;
}) {
  const open = selection?.kind === "node" || selection?.kind === "action" || selection?.kind === "add-action";
  let title = tr("ladder.rung");
  if (selection?.kind === "add-action") title = tr("ladder.newCoil");
  else if (selection?.kind === "action") {
    const a = draft.actions.find((x) => x.id === selection.id);
    title = a ? actionLabel(a, catalog).title : tr("ladder.coil");
  } else if (selection?.kind === "node") {
    const n = findNode(draft.condition, selection.id);
    title = n?.kind === "group" ? (n.op === "AND" ? tr("ladder.seriesBlock") : tr("ladder.parallelBlock")) : tr("ladder.condition");
  }
  return (
    <ItemSheet open={open} onClose={() => onSelect(null)} title={title} sub={tr("ladder.onRung")}>
      <div className="flex flex-col gap-3">
        {open && <InspectorBody selection={selection} draft={draft} catalog={catalog} update={update} select={onSelect} titled={false} />}
      </div>
    </ItemSheet>
  );
}
