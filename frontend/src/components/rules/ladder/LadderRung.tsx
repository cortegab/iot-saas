"use client";

/**
 * One rule drawn as a ladder rung: the WHEN label on the power rail, the IF
 * tree as contacts (series = AND, parallel = OR), the hold timer, then the
 * THEN actions as coils in parallel. Under it (DESIGN.md §9.10), what the
 * Form says in words: the minimum interval, the CLEAR rung (condition false
 * → clear delay → what turns back or notifies) and, for a latching rule, the
 * RESET rung. Read-only unless `onSelect` is given — the ladder editor makes
 * every element selectable, the overview doesn't.
 *
 * `VerticalRung` draws the same rule top to bottom for narrow screens, so the
 * ladder never scrolls sideways; `ResponsiveRung` picks whichever fits.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { layoutCondition } from "@/lib/ladder-layout";
import {
  OPERATOR_ARITY,
  OPERATOR_SYMBOL,
  canClear,
  findNode,
  isReadingRule,
  type ActionDraft,
  type ActuatorActionDraft,
  type ContactDraft,
  type DraftNode,
  type RuleDraft,
} from "@/lib/rule-draft";
import { actionLabel, isBoolContact } from "@/components/rules/editor/fields";
import type { RuleCatalog } from "@/components/rules/editor/useRuleCatalog";
import { cn } from "@/lib/cn";

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
const CAPTION_H = 26;

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

/** One coil on the CLEAR rung: an actuator turned back, or the clear notice. */
interface ClearCoil {
  id: string;
  /** The action it belongs to (selecting it opens that action); none for the notice. */
  actionId?: string;
  title: string;
  detail: string;
}

/** What runs when the condition clears (DESIGN.md §5 rule schema `clear_actions`). */
function clearCoils(draft: RuleDraft, catalog: RuleCatalog): ClearCoil[] {
  if (!canClear(draft) || draft.behaviour === "latch") return [];
  const coils: ClearCoil[] = [];
  for (const a of draft.actions) {
    if (a.kind !== "actuator" || !a.revertOnClear) continue;
    const act: ActuatorActionDraft = a;
    const actuator = catalog.actuatorFor(act.deviceId, act.actuator);
    const back =
      act.valueKind === "boolean"
        ? String(((act.clearBool ?? !act.bool) ? actuator?.on_value : actuator?.off_value) ?? ((act.clearBool ?? !act.bool) ? "ON" : "OFF"))
        : act.valueKind === "number"
          ? String(act.clearNum)
          : act.clearText || "…";
    coils.push({
      id: `clear-${act.id}`,
      actionId: act.id,
      title: `${actuator?.name ?? (act.actuator || "actuator")} = ${back}`,
      detail: catalog.deviceNameById[act.deviceId] ?? "device",
    });
  }
  if (draft.clearNotify) coils.push({ id: "clear-notify", title: "Notify", detail: draft.clearMessage || "condition cleared" });
  return coils;
}

const latching = (d: RuleDraft) => isReadingRule(d) && d.behaviour === "latch";

/** Where everything sits; `width` is what the rung needs to fit unscrolled. */
export function rungGeometry(draft: RuleDraft, interactive: boolean, catalog: RuleCatalog) {
  const layout = layoutCondition(draft.condition);
  const x0 = RAIL_X + LEAD;
  const condEnd = x0 + (layout.width === 0 ? 24 : layout.width * CELL_W);
  const plusX = interactive ? condEnd + 22 : condEnd;
  const afterPlus = interactive ? plusX + 22 : condEnd;
  const showTimer = isReadingRule(draft) && draft.forDuration > 0;
  const clears = clearCoils(draft, catalog);
  // The hold timer and the clear rung's delay sit in the same column.
  const timerColumn = showTimer || (clears.length > 0 && draft.clearDelay > 0);
  const timerX = afterPlus + 8;
  const busX = timerColumn ? timerX + TIMER_W + 20 : afterPlus + 16;
  const coilRows = Math.max(1, draft.actions.length) + (interactive ? 1 : 0);
  const rows = Math.max(layout.height, coilRows);
  const coilX = busX + 40;
  const rightRail = coilX + COIL_W;
  const width = rightRail + RAIL_X;
  const mainBottom = TOP + rows * ROW_H + 6;
  const clearTop = mainBottom + CAPTION_H;
  const clearH = clears.length ? Math.max(1, clears.length) * ROW_H : 0;
  const resetTop = clearTop + clearH + (clears.length ? CAPTION_H : 0);
  const resetH = latching(draft) ? ROW_H : 0;
  const height = (latching(draft) ? resetTop + resetH : clears.length ? clearTop + clearH : mainBottom) + 6;
  return { layout, x0, condEnd, plusX, showTimer, timerX, busX, rows, coilX, rightRail, width, height, mainBottom, clears, clearTop, resetTop };
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
      data-rung-el=""
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

/** A TON timer box on a wire. */
function TimerBox({ x, y, text, label, selected, onSelect }: { x: number; y: number; text: string; label: string; selected: boolean; onSelect?: () => void }) {
  return (
    <Selectable label={label} onSelect={onSelect}>
      <rect x={x} y={y - 16} width={TIMER_W} height={32} rx={6} fill={selected ? ACCENT_FILL : SURFACE} stroke={selected ? ACCENT : INK} strokeWidth={1.4} />
      <text x={x + TIMER_W / 2} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>
        {text}
      </text>
    </Selectable>
  );
}

/** A coil: the round brackets, a glyph, and two lines of text. */
function Coil({ x, y, glyph, title, detail, selected }: { x: number; y: number; glyph: string; title: string; detail: string; selected: boolean }) {
  const cx = x + 18;
  return (
    <>
      <rect x={x - 6} y={y - ROW_H / 2 + 6} width={COIL_W - 4} height={ROW_H - 12} rx={8} fill={selected ? ACCENT_FILL : "transparent"} stroke={selected ? ACCENT : "transparent"} />
      <path d={`M${cx - 6} ${y - 14} Q${cx - 16} ${y} ${cx - 6} ${y + 14}`} fill="none" stroke={INK} strokeWidth={2.2} />
      <path d={`M${cx + 6} ${y - 14} Q${cx + 16} ${y} ${cx + 6} ${y + 14}`} fill="none" stroke={INK} strokeWidth={2.2} />
      {glyph && (
        <text x={cx} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>
          {glyph}
        </text>
      )}
      <text x={cx + 26} y={y - 3} fontSize={12} fontWeight={600} fill={INK}>
        {clip(title, 26)}
      </text>
      <text x={cx + 26} y={y + 13} fontSize={11} fill={MUTED}>
        {clip(detail, 30)}
      </text>
    </>
  );
}

/** Arrow keys move between the rung's elements, in reading order (DESIGN.md §9.10). */
export function rovingKeys(e: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement | SVGElement>("[data-rung-el]"));
  const i = els.indexOf(document.activeElement as HTMLElement);
  if (i < 0 && e.key !== "Home" && e.key !== "End") return;
  e.preventDefault();
  const next =
    e.key === "Home" ? 0 : e.key === "End" ? els.length - 1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? Math.min(i + 1, els.length - 1) : Math.max(i - 1, 0);
  (els[next] as HTMLElement | undefined)?.focus();
}

export function LadderRung({
  draft,
  catalog,
  selection = null,
  onSelect,
  onAddSeriesAtEnd,
  ariaLabel,
  fluid = false,
}: {
  draft: RuleDraft;
  catalog: RuleCatalog;
  selection?: LadderSelection;
  onSelect?: (s: LadderSelection) => void;
  /** Editor only — the "+" after the last contact. */
  onAddSeriesAtEnd?: () => void;
  ariaLabel: string;
  /** Scales down to its container's width (a read-only overview card). */
  fluid?: boolean;
}) {
  const interactive = onSelect !== undefined;
  const g = rungGeometry(draft, interactive, catalog);
  const { layout, x0, condEnd, plusX, showTimer, timerX, busX, coilX, rightRail, width, height } = g;
  const select = (s: LadderSelection) => (onSelect ? () => onSelect(s) : undefined);
  const y0 = rowMid(0);
  const lastCoilRow = Math.max(0, draft.actions.length - 1);

  const selectedNode = selection?.kind === "node" ? findNode(draft.condition, selection.id) : null;
  const selectedBlock =
    selectedNode?.kind === "group" ? layout.blocks.find((b) => b.id === selectedNode.id) : undefined;
  const cooldown = draft.cooldown > 0 && draft.actions.length > 0;

  return (
    <svg
      role={interactive ? "group" : "img"}
      aria-label={ariaLabel}
      width={fluid ? "100%" : width}
      height={fluid ? undefined : height}
      viewBox={`0 0 ${width} ${height}`}
      className="block font-sans"
      style={{ fontFamily: "inherit", height: fluid ? "auto" : undefined }}
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
        <line key={i} x1={x0 + w.x1 * CELL_W} y1={rowMid(w.y1)} x2={x0 + w.x2 * CELL_W} y2={rowMid(w.y2)} stroke={WIRE} strokeWidth={1.6} />
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
          <Selectable key={cell.id} label={`Condition ${text.top} on ${text.bottom}${nc ? " (normally closed)" : ""}`} onSelect={select({ kind: "node", id: node.id })}>
            <rect x={left + 6} y={y - ROW_H / 2 + 4} width={CELL_W - 12} height={ROW_H - 8} rx={8} fill={selected ? ACCENT_FILL : "transparent"} stroke={selected ? ACCENT : "transparent"} />
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

      {/* Condition exit → (+) → hold timer → coil bus */}
      <line x1={condEnd} y1={y0} x2={busX} y2={y0} stroke={WIRE} strokeWidth={1.6} />
      {interactive && onAddSeriesAtEnd && <PlusHotspot x={plusX} y={y0} label="Add a condition in series at the end" onClick={onAddSeriesAtEnd} />}
      {showTimer && (
        <TimerBox x={timerX} y={y0} text={`TON ${draft.forDuration}s`} label={`Hold for ${draft.forDuration} seconds`} selected={selection?.kind === "timing"} onSelect={select({ kind: "timing" })} />
      )}

      {/* The minimum interval, over the coils: they fire at most this often. */}
      {cooldown && (
        <Selectable label={`Minimum interval ${draft.cooldown} seconds`} onSelect={select({ kind: "timing" })}>
          <rect x={coilX - 6} y={TOP - 22} width={150} height={18} rx={4} fill={SURFACE} stroke="var(--color-border)" />
          <text x={coilX + 2} y={TOP - 9} fontSize={10.5} fontWeight={600} fill={MUTED}>
            {`MIN INTERVAL ${draft.cooldown}s`}
          </text>
        </Selectable>
      )}

      {/* Coil bus */}
      {draft.actions.length > 1 && <line x1={busX} y1={y0} x2={busX} y2={rowMid(lastCoilRow)} stroke={WIRE} strokeWidth={1.6} />}

      {/* Coils — every action, in parallel */}
      {draft.actions.map((action, i) => {
        const y = rowMid(i);
        const label = actionLabel(action, catalog);
        const selected = selection?.kind === "action" && selection.id === action.id;
        return (
          <Selectable key={action.id} label={`Action ${label.title} — ${label.detail}`} onSelect={select({ kind: "action", id: action.id })}>
            <line x1={busX} y1={y} x2={coilX + 4} y2={y} stroke={WIRE} strokeWidth={1.6} />
            <Coil x={coilX} y={y} glyph={coilGlyph(action, draft)} title={label.title} detail={label.detail} selected={selected} />
          </Selectable>
        );
      })}

      {interactive && <PlusHotspot x={coilX + 18} y={rowMid(draft.actions.length)} label="Add an action" onClick={() => onSelect?.({ kind: "add-action" })} />}

      {/* CLEAR rung: condition false → clear delay → what turns back. */}
      {g.clears.length > 0 && (
        <>
          <text x={RAIL_X + 8} y={g.mainBottom + 16} fontSize={10.5} fontWeight={700} letterSpacing="0.06em" fill={MUTED}>
            CLEAR
          </text>
          {g.clears.map((c, i) => {
            const y = g.clearTop + i * ROW_H + ROW_H / 2;
            const mid = x0 + CELL_W / 2;
            const selected = selection?.kind === "action" && selection.id === c.actionId;
            return (
              <g key={c.id}>
                {i === 0 && (
                  <>
                    <line x1={RAIL_X} y1={y} x2={mid - BRACKET} y2={y} stroke={WIRE} strokeWidth={1.6} />
                    <line x1={mid - BRACKET} y1={y - 13} x2={mid - BRACKET} y2={y + 13} stroke={INK} strokeWidth={2.2} />
                    <line x1={mid + BRACKET} y1={y - 13} x2={mid + BRACKET} y2={y + 13} stroke={INK} strokeWidth={2.2} />
                    <line x1={mid - BRACKET + 3} y1={y + 12} x2={mid + BRACKET - 3} y2={y - 12} stroke={INK} strokeWidth={1.8} />
                    <text x={mid} y={y - 20} textAnchor="middle" fontSize={12} fontWeight={600} fill={INK}>
                      Condition false
                    </text>
                    <line x1={mid + BRACKET} y1={y} x2={busX} y2={y} stroke={WIRE} strokeWidth={1.6} />
                    {draft.clearDelay > 0 && (
                      <TimerBox x={timerX} y={y} text={`TON ${draft.clearDelay}s`} label={`Clear delay ${draft.clearDelay} seconds`} selected={selection?.kind === "timing"} onSelect={select({ kind: "timing" })} />
                    )}
                  </>
                )}
                {i > 0 && <line x1={busX} y1={y - ROW_H} x2={busX} y2={y} stroke={WIRE} strokeWidth={1.6} />}
                <Selectable
                  label={`On clear ${c.title} — ${c.detail}`}
                  onSelect={c.actionId ? select({ kind: "action", id: c.actionId }) : select({ kind: "timing" })}
                >
                  <line x1={busX} y1={y} x2={coilX + 4} y2={y} stroke={WIRE} strokeWidth={1.6} />
                  <Coil x={coilX} y={y} glyph={c.actionId ? "R" : "!"} title={c.title} detail={c.detail} selected={selected} />
                </Selectable>
              </g>
            );
          })}
        </>
      )}

      {/* RESET rung: a latched rule fires again only after someone resets it. */}
      {latching(draft) && (
        <>
          <text x={RAIL_X + 8} y={g.resetTop - 10} fontSize={10.5} fontWeight={700} letterSpacing="0.06em" fill={MUTED}>
            RESET
          </text>
          {(() => {
            const y = g.resetTop + ROW_H / 2;
            const mid = x0 + CELL_W / 2;
            return (
              <Selectable label="Latch: reset by a person (Reset latch)" onSelect={select({ kind: "timing" })}>
                <line x1={RAIL_X} y1={y} x2={mid - BRACKET} y2={y} stroke={WIRE} strokeWidth={1.6} />
                <line x1={mid - BRACKET} y1={y - 13} x2={mid - BRACKET} y2={y + 13} stroke={INK} strokeWidth={2.2} />
                <line x1={mid + BRACKET} y1={y - 13} x2={mid + BRACKET} y2={y + 13} stroke={INK} strokeWidth={2.2} />
                <text x={mid} y={y - 20} textAnchor="middle" fontSize={12} fontWeight={600} fill={INK}>
                  Reset latch
                </text>
                <text x={mid} y={y + 29} textAnchor="middle" fontSize={11} fill={MUTED}>
                  by a person
                </text>
                <line x1={mid + BRACKET} y1={y} x2={coilX + 4} y2={y} stroke={WIRE} strokeWidth={1.6} />
                <Coil x={coilX} y={y} glyph="R" title="Latch released" detail="fires again when true" selected={false} />
              </Selectable>
            );
          })()}
        </>
      )}
    </svg>
  );
}

/** The same rule top to bottom, for narrow screens (DESIGN.md §9.10): one
 * element per line, groups indented with a dashed rail, never sideways. */
export function VerticalRung({
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
  onAddSeriesAtEnd?: () => void;
  ariaLabel: string;
}) {
  const interactive = onSelect !== undefined;
  const clears = clearCoils(draft, catalog);
  const item = (key: string, sym: string, title: string, sub: string | null, label: string, sel: LadderSelection, selected: boolean, timer = false) => {
    const body = (
      <>
        <span aria-hidden className="min-w-[30px] font-mono text-meta font-bold text-ink">
          {sym}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="break-words text-meta font-medium text-ink">{title}</b>
          {sub && <small className="text-xs text-ink-muted">{sub}</small>}
        </span>
      </>
    );
    const cls = cn(
      "flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left",
      timer ? "bg-surface-raised" : "bg-surface",
      selected ? "border-accent bg-accent-muted" : "border-border",
    );
    return interactive ? (
      <button key={key} type="button" data-rung-el="" aria-label={label} onClick={() => onSelect?.(sel)} className={cn(cls, "hover:border-accent")}>
        {body}
      </button>
    ) : (
      <div key={key} className={cls}>
        {body}
      </div>
    );
  };
  const caption = (text: string) => <p className="mt-1.5 font-mono text-xs font-semibold uppercase tracking-[0.04em] text-ink-muted">{text}</p>;

  const node = (n: DraftNode): ReactNode => {
    if (n.kind === "contact") {
      const t = contactText(n, catalog);
      const nc = isBoolContact(n, catalog) && n.value === 0;
      return item(n.id, nc ? "[/]" : "[ ]", t.top, t.bottom, `Condition ${t.top} on ${t.bottom}`, { kind: "node", id: n.id }, selection?.kind === "node" && selection.id === n.id);
    }
    return (
      <div key={n.id} className={cn("flex flex-col gap-1", n.op === "OR" && "border-l-2 border-dashed border-accent pl-3")}>
        <span className="font-mono text-xs font-bold tracking-[0.05em] text-accent-strong">{n.op === "AND" ? "ALL OF" : "ANY OF"}</span>
        <div className="flex flex-col gap-1">{n.children.map((c) => node(c))}</div>
      </div>
    );
  };

  return (
    <div role={interactive ? "group" : "img"} aria-label={ariaLabel} className="flex flex-col gap-1.5">
      {caption("When")}
      {item("when", "⚡", triggerLabel(draft, catalog).replace(/^\S+\s/, ""), null, `Trigger: ${triggerLabel(draft, catalog)}`, { kind: "when" }, selection?.kind === "when")}
      {draft.condition && (
        <>
          {caption("If")}
          <div className="flex flex-col gap-1 border-l-[2.5px] border-ink pl-3.5">{node(draft.condition)}</div>
        </>
      )}
      {interactive && onAddSeriesAtEnd && (
        <button type="button" data-rung-el="" onClick={onAddSeriesAtEnd} className="flex min-h-9 items-center gap-2 rounded-lg border border-dashed border-accent px-2.5 text-meta text-accent">
          + Add a condition in series at the end
        </button>
      )}
      {isReadingRule(draft) && draft.forDuration > 0 && item("hold", "TON", `Hold ${draft.forDuration} s`, "the condition must stay true this long", `Hold for ${draft.forDuration} seconds`, { kind: "timing" }, selection?.kind === "timing", true)}
      {caption(draft.cooldown > 0 && draft.actions.length ? `Then · at most every ${draft.cooldown} s` : "Then")}
      {draft.actions.map((a) => {
        const l = actionLabel(a, catalog);
        const glyph = coilGlyph(a, draft);
        return item(a.id, `(${glyph || " "})`, l.title, l.detail, `Action ${l.title} — ${l.detail}`, { kind: "action", id: a.id }, selection?.kind === "action" && selection.id === a.id);
      })}
      {interactive && (
        <button type="button" data-rung-el="" aria-label="Add an action" onClick={() => onSelect?.({ kind: "add-action" })} className="flex min-h-9 items-center gap-2 rounded-lg border border-dashed border-accent px-2.5 text-meta text-accent">
          + Add an action
        </button>
      )}
      {clears.length > 0 && (
        <>
          {caption("Clear")}
          {item("clear-when", "[/]", "Condition false", draft.clearDelay > 0 ? `for ${draft.clearDelay} s (clear delay)` : null, "When the condition is false", { kind: "timing" }, false, draft.clearDelay > 0)}
          {clears.map((c) => item(c.id, c.actionId ? "(R)" : "(!)", c.title, c.detail, `On clear ${c.title} — ${c.detail}`, c.actionId ? { kind: "action", id: c.actionId } : { kind: "timing" }, false))}
        </>
      )}
      {latching(draft) && (
        <>
          {caption("Reset")}
          {item("reset", "(R)", "Reset latch, by a person", "then it fires again when true", "Latch: reset by a person (Reset latch)", { kind: "timing" }, false)}
        </>
      )}
    </div>
  );
}

/** Horizontal when it fits its container, vertical otherwise (DESIGN.md
 * §9.10), with arrow-key movement between elements. */
export function ResponsiveRung({ fit = false, ...props }: Parameters<typeof LadderRung>[0] & { fit?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setRoom(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const need = rungGeometry(props.draft, props.onSelect !== undefined, props.catalog).width;
  // It scales down to fit first, and goes vertical only when that would make it
  // unreadable: below 55% for a read-only rung (`fit`), below 80% in the editor,
  // where its text must stay legible to edit (its smallest is 10.5 px).
  const tooNarrow = room != null && room < need;
  const scaled = tooNarrow && (room ?? 0) / need >= (fit ? 0.55 : 0.8);
  const vertical = tooNarrow && !scaled;
  return (
    <div ref={ref} onKeyDown={rovingKeys} className="min-w-0">
      {vertical ? <VerticalRung {...props} /> : <LadderRung {...props} fluid={scaled} />}
    </div>
  );
}
