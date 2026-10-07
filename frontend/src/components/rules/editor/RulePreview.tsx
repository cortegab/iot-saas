"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleAlert, CircleX, Play } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MiniStrip, type StripCell } from "@/components/ui/MiniStrip";
import { ApiRequestError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { contacts, draftToRequest, isReadingRule, validateDraft, type RuleDraft } from "@/lib/rule-draft";
import { ruleChecks, wouldSend } from "@/lib/rule-preview";
import type { RuleCatalog } from "./useRuleCatalog";
import type { components } from "@/types/api";

type SimulateResponse = components["schemas"]["SimulateResponse"];
type RuleResponse = components["schemas"]["RuleResponse"];

const HOUR = 3_600_000;
/** More than this many firings in 24 h reads as a noisy rule. */
const NOISY = 12;

function PreviewCard({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-4 shadow-card", className)}>
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** The request body for a draft, or null while it's still incomplete. */
function draftBody(draft: RuleDraft): Record<string, unknown> | null {
  if (validateDraft(draft)) return null;
  try {
    const body = draftToRequest(draft);
    return { ...body, name: (body.name as string | undefined) || "Draft" };
  } catch {
    return null;
  }
}

/** Debounced so typing doesn't fire a request per keystroke. */
function useDebounced<T>(value: T, ms = 700): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The workbench preview (DESIGN.md §9.4), live as you edit. Replay and dry
 * run go through POST /rules/simulate, which reads stored data and live
 * values API-side, writes nothing and sends nothing (CLAUDE.md §9.1). */
export function RulePreview({
  draft,
  catalog,
  ruleId,
  layout = "stack",
}: {
  draft: RuleDraft;
  catalog: RuleCatalog;
  /** The saved rule being edited, left out of "other rules". */
  ruleId?: string;
  /** "stack" in the sticky column; "grid" under the ladder. */
  layout?: "stack" | "grid";
}) {
  const api = useApi();
  const { memberships, currentTenantId } = useAuth();
  const tenantSlug = memberships.find((m) => m.tenant_id === currentTenantId)?.tenant_slug ?? "?";
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const body = useMemo(() => draftBody(draft), [draft]);
  const bodyKey = useDebounced(body ? JSON.stringify(body) : null);
  const reading = isReadingRule(draft);

  // 1 · Last 24 hours (replay)
  const [replay, setReplay] = useState<{ fired: string[]; error?: string } | null>(null);
  useEffect(() => {
    if (!bodyKey || !reading) {
      setReplay(null);
      return;
    }
    let cancelled = false;
    const to = new Date();
    const from = new Date(to.getTime() - 24 * HOUR);
    api
      .query<SimulateResponse>("/rules/simulate", { rule: JSON.parse(bodyKey), replay: { from: from.toISOString(), to: to.toISOString() } })
      .then((r) => !cancelled && setReplay({ fired: r.replay?.would_have_fired_at ?? [] }))
      .catch((err) => !cancelled && setReplay({ fired: [], error: err instanceof ApiRequestError ? err.message : "Couldn't replay." }));
    return () => {
      cancelled = true;
    };
  }, [api, bodyKey, reading]);

  const replayCells = useMemo<StripCell[]>(() => {
    const cells: StripCell[] = Array(48).fill("idle");
    const start = Date.now() - 24 * HOUR;
    for (const t of replay?.fired ?? []) {
      const i = Math.min(47, Math.max(0, Math.floor((new Date(t).getTime() - start) / (HOUR / 2))));
      cells[i] = "fired";
    }
    return cells;
  }, [replay]);

  // 2 · Would send + dry run
  const slugById = useMemo(() => new Map(catalog.devices.map((d) => [d.id, d.slug])), [catalog.devices]);
  const sends = wouldSend(draft, tenantSlug, (id) => slugById.get(id));
  const [dry, setDry] = useState<{ busy?: boolean; result?: SimulateResponse; error?: string }>({});
  useEffect(() => setDry({}), [bodyKey]);
  async function dryRun(overrides: { device_id: string; metric: string; value: number }[] = []) {
    if (!body) return;
    setDry({ busy: true });
    try {
      const result = await api.query<SimulateResponse>("/rules/simulate", { rule: body, overrides });
      setDry({ result });
    } catch (err) {
      setDry({ error: err instanceof ApiRequestError ? err.message : "Couldn't run it." });
    }
  }

  // 3 · Checks
  const checks = ruleChecks(draft);

  // 4 · Other rules on these actuators
  const targets = draft.actions.filter((a) => a.kind === "actuator" && a.deviceId && a.actuator);
  const others = (rules ?? [])
    .filter((r) => r.id !== ruleId && r.enabled)
    .flatMap((r) =>
      r.actions
        .filter((a) => a.type === "actuator_command")
        .flatMap((a) => {
          const hit = targets.find((t) => t.kind === "actuator" && t.deviceId === a.device_id && t.actuator === a.actuator);
          if (!hit || hit.kind !== "actuator") return [];
          const mine = hit.valueKind === "boolean" ? hit.bool : hit.valueKind === "number" ? hit.num : hit.text;
          return [{ rule: r, actuator: String(a.actuator), conflict: a.value !== mine }];
        }),
    );

  // 5 · Try other values
  const signals = useMemo(() => {
    const seen = new Map<string, { device_id: string; metric: string; label: string }>();
    for (const c of contacts(draft.condition)) {
      if (!c.deviceId || !c.metric) continue;
      seen.set(`${c.deviceId}/${c.metric}`, {
        device_id: c.deviceId,
        metric: c.metric,
        label: `${catalog.metricFor(c.deviceId, c.metric)?.name ?? c.metric} · ${catalog.deviceNameById[c.deviceId] ?? "device"}`,
      });
    }
    return [...seen.values()];
  }, [draft.condition, catalog]);
  const [tryValues, setTryValues] = useState<Record<string, string>>({});
  const [tryResult, setTryResult] = useState<SimulateResponse | null>(null);
  const tryKey = useDebounced(JSON.stringify(tryValues), 500);
  useEffect(() => {
    const overrides = Object.entries(JSON.parse(tryKey) as Record<string, string>)
      .filter(([, v]) => v.trim() !== "" && Number.isFinite(Number(v)))
      .map(([k, v]) => {
        const [device_id, metric] = k.split("/");
        return { device_id, metric, value: Number(v) };
      });
    if (!body || overrides.length === 0) {
      setTryResult(null);
      return;
    }
    let cancelled = false;
    api
      .query<SimulateResponse>("/rules/simulate", { rule: body, overrides })
      .then((r) => !cancelled && setTryResult(r))
      .catch(() => !cancelled && setTryResult(null));
    return () => {
      cancelled = true;
    };
    // body is covered by bodyKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, tryKey, bodyKey]);

  const fired = replay?.fired ?? [];
  return (
    <div className={cn(layout === "grid" ? "grid gap-3 md:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-3")} aria-label="Preview">
      <PreviewCard title="Last 24 hours">
        {!reading ? (
          <p className="text-[13px] text-ink-muted">{draft.when.type === "schedule" ? "Fires on its schedule." : "Fires on each event, not on readings."}</p>
        ) : !body ? (
          <p className="text-[13px] text-ink-muted">Finish the conditions and actions to replay the last 24 hours.</p>
        ) : !replay ? (
          <p className="text-[13px] text-ink-muted">Replaying…</p>
        ) : replay.error ? (
          <p className="text-[13px] text-status-error">{replay.error}</p>
        ) : (
          <>
            <MiniStrip variant="replay" cells={replayCells} axis={["24 h ago", "12 h ago", "now"]} label={`Would have fired ${fired.length} times in 24 h`} />
            <p className="text-[13px] text-ink">
              {fired.length === 0
                ? "Wouldn't have fired in the last 24 hours."
                : `Would have fired ${fired.length}× at ${fired.slice(0, 3).map(hhmm).join(", ")}${fired.length > 3 ? "…" : ""}`}
            </p>
            {fired.length > NOISY && (
              <p className="flex gap-1.5 text-[12.5px] text-status-pending">
                <AlertTriangle aria-hidden size={13} className="mt-0.5 shrink-0" />
                Noisy: it would fire more than {NOISY} times a day. Raise the threshold, hold longer, or widen the interval.
              </p>
            )}
          </>
        )}
      </PreviewCard>

      <PreviewCard title="Would send">
        {sends.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Nothing yet. Add an action.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sends.map((s, i) => (
              <li key={i} className="flex flex-col gap-0.5">
                <span className="text-[11.5px] text-ink-muted">
                  {s.kind === "command" ? "Command" : s.kind === "clear" ? "When it clears" : s.kind === "email" ? "Email to" : s.kind === "webhook" ? "Webhook" : "Notification"}
                </span>
                <code className="break-all font-mono text-[12px] text-ink">{s.target}</code>
                {s.payload && <code className="break-all font-mono text-[12px] text-ink-muted">{s.payload}</code>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
          <Button size="sm" variant="secondary" disabled={!body || dry.busy} onClick={() => void dryRun()}>
            <Play aria-hidden size={13} />
            {dry.busy ? "Checking…" : "Dry run with live readings"}
          </Button>
          <p className="text-[11.5px] text-ink-muted">Reports what would happen now. Sends nothing.</p>
          {dry.error && <p className="text-[12.5px] text-status-error">{dry.error}</p>}
          {dry.result && (
            <p role="status" className={cn("text-[13px]", dry.result.would_fire ? "text-status-pending" : "text-ink")}>
              {dry.result.unavailable_signals.length > 0
                ? `Can't tell now: ${dry.result.unavailable_signals.map((s) => `${s.metric} on ${s.device_name ?? "a device"} is ${s.state}`).join("; ")}. Unknown data never fires.`
                : dry.result.would_fire
                  ? "It would fire right now."
                  : "It wouldn't fire right now."}
            </p>
          )}
        </div>
      </PreviewCard>

      <PreviewCard title="Checks">
        <ul className="flex flex-col gap-1.5">
          {checks.map((c) => (
            <li key={c.id} className="flex gap-2 text-[13px]">
              {/* Red ✕ only for what blocks saving; a safety check that isn't
                  met is a warning — the amber "!" the section rail uses. */}
              {c.ok ? (
                <CheckCircle2 aria-hidden size={15} className="mt-px shrink-0 text-status-online" />
              ) : c.blocking ? (
                <CircleX aria-hidden size={15} className="mt-px shrink-0 text-status-error" />
              ) : (
                <CircleAlert aria-hidden size={15} className="mt-px shrink-0 text-status-pending" />
              )}
              <span className="flex flex-col">
                <span className={c.ok ? "text-ink" : "font-medium text-ink"}>
                  {c.label}
                  <span className="sr-only">{c.ok ? ": passes" : c.blocking ? ": needs fixing" : ": warning"}</span>
                </span>
                {c.detail && <span className="text-[12px] text-ink-muted">{c.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </PreviewCard>

      <PreviewCard title="Other rules on these actuators">
        {targets.length === 0 ? (
          <p className="text-[13px] text-ink-muted">This rule doesn&apos;t switch an actuator.</p>
        ) : others.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No other enabled rule drives them.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {others.map((o, i) => (
              <li key={i} className="flex flex-col text-[13px]">
                <Link href={`/rules/${o.rule.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                  {o.rule.name}
                </Link>
                <span className={cn("text-[12px]", o.conflict ? "text-status-pending" : "text-ink-muted")}>
                  {o.conflict ? `Also sets ${o.actuator} to a different value. The last command wins.` : `Also drives ${o.actuator}, the same way.`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PreviewCard>

      {signals.length > 0 && (
        <details className="group rounded-xl border border-border bg-surface p-4 shadow-card">
          <summary className="cursor-pointer text-[13px] font-semibold text-ink">Try other values</summary>
          <div className="mt-3 flex flex-col gap-2">
            {signals.map((s) => {
              const k = `${s.device_id}/${s.metric}`;
              return (
                <label key={k} className="flex flex-col gap-1 text-[12.5px] text-ink-muted">
                  {s.label}
                  <Input inputMode="decimal" value={tryValues[k] ?? ""} placeholder="live value" onChange={(e) => setTryValues((v) => ({ ...v, [k]: e.target.value }))} />
                </label>
              );
            })}
            <p role="status" className="text-[13px] text-ink">
              {tryResult ? (tryResult.would_fire ? "With these values it would fire." : "With these values it wouldn't fire.") : "Type a value to see the outcome."}
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
