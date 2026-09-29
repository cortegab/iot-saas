"use client";

/**
 * One rule drawn as a ladder rung: the WHEN label on the power rail, the IF
 * tree as contacts (series = AND, parallel = OR), an optional hold timer,
 * then the THEN actions as coils in parallel. Read-only unless `onSelect` is
 * given — the ladder editor makes every element selectable, the overview
 * doesn't.
 */

import type { KeyboardEvent, ReactNode } from "react";
import { layoutCondition } from "@/lib/ladder-layout";
import {
  OPERATOR_ARITY,
  OPERATOR_SYMBOL,
  canClear,
  findNode,
  isReadingRule,
  type ActionDraft,
  type ContactDraft,
  type RuleDraft,
} from "@/lib/rule-draft";
import { actionLabel, isBoolContact } from "@/components/rules/editor/fields";
import type { RuleCatalog } from "@/components/rules/editor/useRuleCatalog";

export type LadderSelection =
  | { kind: "when" }
  | { kind: "timing" }
  | { kind: "node"; id: string }
  | { kind: "action"; id: string }
  | { kind: "add-action" }
  | null;

const CELL_W = 176;
const ROW_H = 78;
const TOP = 34;
const RAIL_X = 10;
const LEAD = 36;
const TIMER_W = 92;
const COIL_W = 236;
const BRACKET = 11;

const INK = "var(--color-ink)";
const MUTED = "var(--color-ink-muted)";
const WIRE = "var(--color-ink-muted)";
const ACCENT = "var(--color-accent)";
const ACCENT_FILL = "var(--color-accent-muted)";
const SURFACE = "var(--color-surface)";

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function rowMid(row: number): number {
  return TOP + row * ROW_H + ROW_H / 2;
}

function triggerLabel(draft: RuleDraft, catalog: RuleCatalog): string {
  const w = draft.when;
  if (w.type === "schedule") return `⏱ ${w.cron}${w.timezone && w.timezone !== "UTC" ? ` ${w.timezone}` : ""}`;
  if (w.type === "manual") return "✋ Run manually";
  if (w.type === "device_status") {
    const name = catalog.deviceNameById[w.statusDeviceId] ?? "device";
    return `⏻ ${name} ${w.transition === "connected" ? "connects" : "disconnects"}`;
  }
  return "⚡ On reading";
}

function contactText(c: ContactDraft, catalog: RuleCatalog): { top: string; bottom: string } {
  const metric = catalog.metricFor(c.deviceId, c.metric)?.name ?? (c.metric || "metric?");
  const device = catalog.deviceNameById[c.deviceId] ?? "device?";
  if (isBoolContact(c, catalog)) return { top: metric, bottom: device };
  const arity = OPERATOR_ARITY[c.operator] ?? "one";
  const sym = OPERATOR_SYMBOL[c.operator] ?? c.operator;
  let rhs = "";
  if (arity === "one") {
    rhs =
      c.rhsKind === "metric"
        ? `${catalog.deviceNameById[c.rhsDeviceId] ?? "?"}.${c.rhsMetric || "?"}`
        : String(c.value);
  } else if (arity === "range") rhs = `${c.low}–${c.high}`;
  else if (arity === "set") rhs = `{${c.setText}}`;
  return { top: `${metric} ${sym} ${rhs}`.trim(), bottom: device };
}

function coilGlyph(action: ActionDraft, draft: RuleDraft): string {
  if (isReadingRule(draft) && draft.behaviour === "latch") return "S";
  if (action.kind === "actuator") return canClear(draft) && action.revertOnClear ? "" : "P";
  if (action.kind === "email") return "✉";
  if (action.kind === "webhook") return "⇢";
  return "!";
}

function Selectable({
  label,
  onSelect,
  children,
}: {
  label: string;
  onSelect?: () => void;
  children: ReactNode;
}) {
  if (!onSelect) return <g>{children}</g>;
  const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  };
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className="cursor-pointer outline-none [&:focus-visible>rect:first-child]:stroke-[var(--color-accent)]"
    >
      {children}
    </g>
  );
}

function PlusHotspot({ x, y, label, onClick }: { x: number; y: number; label: string; onClick: () => void }) {
  return (
    <Selectable label={label} onSelect={onClick}>
      <rect x={x - 12} y={y - 12} width={24} height={24} rx={12} fill={SURFACE} stroke={ACCENT} strokeDasharray="3 2" />
      <path d={`M${x - 5} ${y}H${x + 5}M${x} ${y - 5}V${y + 5}`} stroke={ACCENT} strokeWidth={1.6} />
    </Selectable>
  );
}

export function LadderRung({
  draft,
  catalog,
  selection = null,
  onSelect,
  onAddSeriesAtEnd,
  ariaLabel,
}: {
  draft: RuleDraft;
  catalog: RuleCatalog;
  selection?: LadderSelection;
  onSelect?: (s: LadderSelection) => void;
  /** Editor only — the "+" after the last contact. */
  onAddSeriesAtEnd?: () => void;
  ariaLabel: string;
}) {
  const layout = layoutCondition(draft.condition);
  const interactive = onSelect !== undefined;
  const select = (s: LadderSelection) => (onSelect ? () => onSelect(s) : undefined);

  const x0 = RAIL_X + LEAD;
  const condEnd = x0 + (layout.width === 0 ? 24 : layout.width * CELL_W);
  const plusX = interactive ? condEnd + 22 : condEnd;
  const afterPlus = interactive ? plusX + 22 : condEnd;
  const showTimer = isReadingRule(draft) && draft.forDuration > 0;
  const timerX = afterPlus + 8;
  const busX = showTimer ? timerX + TIMER_W + 20 : afterPlus + 16;
  const coilRows = Math.max(1, draft.actions.length) + (interactive ? 1 : 0);
  const rows = Math.max(layout.height, coilRows);
  const coilX = busX + 40;
  const rightRail = coilX + COIL_W;
  const width = rightRail + RAIL_X;
  const height = TOP + rows * ROW_H + 6;
  const y0 = rowMid(0);
  const lastCoilRow = Math.max(0, draft.actions.length - 1);

  const selectedNode = selection?.kind === "node" ? findNode(draft.condition, selection.id) : null;
  const selectedBlock =
    selectedNode?.kind === "group" ? layout.blocks.find((b) => b.id === selectedNode.id) : undefined;

  return (
    <svg
      role={interactive ? "group" : "img"}
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block font-sans"
      style={{ fontFamily: "inherit" }}
    >
      {/* Power rails */}
      <line x1={RAIL_X} y1={TOP - 6} x2={RAIL_X} y2={height - 4} stroke={INK} strokeWidth={3} />
      <line x1={rightRail} y1={TOP - 6} x2={rightRail} y2={height - 4} stroke={MUTED} strokeWidth={2} opacity={0.5} />

      {/* WHEN label on the rail */}
      <Selectable label={`Trigger: ${triggerLabel(draft, catalog)}`} onSelect={select({ kind: "when" })}>
        <rect
          x={RAIL_X - 4}
          y={2}
          width={Math.max(140, triggerLabel(draft, catalog).length * 7.4 + 20)}
          height={24}
          rx={6}
          fill={selection?.kind === "when" ? ACCENT_FILL : SURFACE}
          stroke={selection?.kind === "when" ? ACCENT : "var(--color-border)"}
        />
        <text x={RAIL_X + 6} y={18} fontSize={12} fontWeight={600} fill={INK}>
          {triggerLabel(draft, catalog)}
        </text>
      </Selectable>

      {/* Lead-in wire and the wire through an empty condition */}
      <line x1={RAIL_X} y1={y0} x2={x0} y2={y0} stroke={WIRE} strokeWidth={1.6} />
      {layout.width === 0 && <line x1={x0} y1={y0} x2={condEnd} y2={y0} stroke={WIRE} strokeWidth={1.6} />}

      {/* Selected block outline */}
      {selectedBlock && (
        <rect
          x={x0 + selectedBlock.x * CELL_W + 2}
          y={TOP + selectedBlock.y * ROW_H + 2}
          width={selectedBlock.width * CELL_W - 4}
          height={selectedBlock.height * ROW_H - 4}
          rx={10}
          fill="none"
          stroke={ACCENT}
          strokeDasharray="6 4"
        />
      )}

      {/* Parallel-branch buses and fillers */}
      {layout.wires.map((w, i) => (
        <line
          key={i}
          x1={x0 + w.x1 * CELL_W}
          y1={rowMid(w.y1)}
          x2={x0 + w.x2 * CELL_W}
          y2={rowMid(w.y2)}
          stroke={WIRE}
          strokeWidth={1.6}
        />
      ))}

      {/* Contacts */}
      {layout.contacts.map((cell) => {
        const node = findNode(draft.condition, cell.id);
        if (!node || node.kind !== "contact") return null;
        const left = x0 + cell.x * CELL_W;
        const mid = left + CELL_W / 2;
        const y = rowMid(cell.y);
        const text = contactText(node, catalog);
        const nc = isBoolContact(node, catalog) && node.value === 0;
        const selected = selection?.kind === "node" && selection.id === node.id;
        return (
          <Selectable
            key={cell.id}
            label={`Condition ${text.top} on ${text.bottom}${nc ? " (normally closed)" : ""}`}
            onSelect={select({ kind: "node", id: node.id })}
          >
            <rect
              x={left + 6}
              y={y - ROW_H / 2 + 4}
              width={CELL_W - 12}
              height={ROW_H - 8}
              rx={8}
              fill={selected ? ACCENT_FILL : "transparent"}
              stroke={selected ? ACCENT : "transparent"}
            />
            <line x1={left} y1={y} x2={mid - BRACKET} y2={y} stroke={WIRE} strokeWidth={1.6} />
            <line x1={mid + BRACKET} y1={y} x2={left + CELL_W} y2={y} stroke={WIRE} strokeWidth={1.6} />
            <line x1={mid - BRACKET} y1={y - 13} x2={mid - BRACKET} y2={y + 13} stroke={INK} strokeWidth={2.2} />
            <line x1={mid + BRACKET} y1={y - 13} x2={mid + BRACKET} y2={y + 13} stroke={INK} strokeWidth={2.2} />
            {nc && <line x1={mid - BRACKET + 3} y1={y + 12} x2={mid + BRACKET - 3} y2={y - 12} stroke={INK} strokeWidth={1.8} />}
            <text x={mid} y={y - 20} textAnchor="middle" fontSize={12} fontWeight={600} fill={INK}>
              {clip(text.top, 24)}
            </text>
            <text x={mid} y={y + 29} textAnchor="middle" fontSize={11} fill={MUTED}>
              {clip(text.bottom, 26)}
            </text>
          </Selectable>
        );
      })}

      {/* Condition exit → (+) → timer → coil bus */}
      <line x1={condEnd} y1={y0} x2={busX} y2={y0} stroke={WIRE} strokeWidth={1.6} />
      {interactive && onAddSeriesAtEnd && (
        <PlusHotspot x={plusX} y={y0} label="Add a condition in series at the end" onClick={onAddSeriesAtEnd} />
      )}
      {showTimer && (
        <Selectable label={`Hold for ${draft.forDuration} seconds`} onSelect={select({ kind: "timing" })}>
          <rect
            x={timerX}
            y={y0 - 16}
            width={TIMER_W}
            height={32}
            rx={6}
            fill={selection?.kind === "timing" ? ACCENT_FILL : SURFACE}
            stroke={selection?.kind === "timing" ? ACCENT : INK}
            strokeWidth={1.4}
          />
          <text x={timerX + TIMER_W / 2} y={y0 + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>
            {`HOLD ${draft.forDuration}s`}
          </text>
        </Selectable>
      )}

      {/* Coil bus */}
      {draft.actions.length > 1 && (
        <line x1={busX} y1={y0} x2={busX} y2={rowMid(lastCoilRow)} stroke={WIRE} strokeWidth={1.6} />
      )}

      {/* Coils — every action, in parallel */}
      {draft.actions.map((action, i) => {
        const y = rowMid(i);
        const cx = coilX + 18;
        const label = actionLabel(action, catalog);
        const glyph = coilGlyph(action, draft);
        const selected = selection?.kind === "action" && selection.id === action.id;
        return (
          <Selectable
            key={action.id}
            label={`Action ${label.title} — ${label.detail}`}
            onSelect={select({ kind: "action", id: action.id })}
          >
            <rect
              x={coilX - 6}
              y={y - ROW_H / 2 + 6}
              width={COIL_W - 4}
              height={ROW_H - 12}
              rx={8}
              fill={selected ? ACCENT_FILL : "transparent"}
              stroke={selected ? ACCENT : "transparent"}
            />
            <line x1={busX} y1={y} x2={cx - 14} y2={y} stroke={WIRE} strokeWidth={1.6} />
            <path d={`M${cx - 6} ${y - 14} Q${cx - 16} ${y} ${cx - 6} ${y + 14}`} fill="none" stroke={INK} strokeWidth={2.2} />
            <path d={`M${cx + 6} ${y - 14} Q${cx + 16} ${y} ${cx + 6} ${y + 14}`} fill="none" stroke={INK} strokeWidth={2.2} />
            {glyph && (
              <text x={cx} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>
                {glyph}
              </text>
            )}
            <text x={cx + 26} y={y - 3} fontSize={12} fontWeight={600} fill={INK}>
              {clip(label.title, 26)}
            </text>
            <text x={cx + 26} y={y + 13} fontSize={11} fill={MUTED}>
              {clip(label.detail, 30)}
            </text>
          </Selectable>
        );
      })}

      {interactive && (
        <PlusHotspot
          x={coilX + 18}
          y={rowMid(draft.actions.length)}
          label="Add an action"
          onClick={() => onSelect?.({ kind: "add-action" })}
        />
      )}
    </svg>
  );
}
