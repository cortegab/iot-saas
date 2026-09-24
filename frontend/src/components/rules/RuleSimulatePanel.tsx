"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { ApiRequestError } from "@/lib/api-client";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";
import { leafPredicates, type RhsSpec } from "./RuleSummary";

type RuleResponse = components["schemas"]["RuleResponse"];
type SimulateResponse = components["schemas"]["SimulateResponse"];

type SignalState = "fresh" | "stale" | "missing";
type LeafNode = {
  kind: "leaf";
  device_id: string;
  metric: string;
  operator: string;
  rhs: RhsSpec | null;
  observed_value: number | null;
  observed_at: string | null;
  signal_state: SignalState;
  // Only present when rhs.source === "metric".
  observed_rhs_value?: number | null;
  rhs_signal_state?: SignalState;
  result: boolean;
};
type GroupNode = { kind: "group"; op: "AND" | "OR"; result: boolean; predicates: TreeNode[] };
type TreeNode = LeafNode | GroupNode;

const CHANGE_OPERATORS = new Set(["changed", "increased", "decreased"]);

function rhsLabel(rhs: RhsSpec | null): string {
  if (rhs == null) return "";
  if (rhs.source === "static") return String(rhs.value);
  if (rhs.source === "range") return `${rhs.low}–${rhs.high}`;
  if (rhs.source === "set") return rhs.values.join(", ");
  return `${rhs.metric} (another device)`;
}

const SECTION_LABEL = "text-xs font-medium uppercase tracking-wide text-ink-muted";

function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

function ConditionTree({ node }: { node: TreeNode }) {
  if (node.kind === "group") {
    return (
      <div className="border-l border-border pl-3">
        <div className="mb-1 text-xs font-medium text-ink-muted">
          {node.op} · {node.result ? "met" : "not met"}
        </div>
        <div className="flex flex-col gap-1.5">
          {node.predicates.map((child, i) => (
            <ConditionTree key={i} node={child} />
          ))}
        </div>
      </div>
    );
  }
  const tone =
    node.signal_state !== "fresh" ? "pending" : node.result ? "online" : "unknown";
  const label =
    node.signal_state !== "fresh"
      ? `no data (${node.signal_state})`
      : node.result
        ? "met"
        : "not met";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge tone={tone} variant="dot" label={label} />
      <span className="text-ink">
        {node.metric} {node.operator}
        {!CHANGE_OPERATORS.has(node.operator) && ` ${rhsLabel(node.rhs)}`}
      </span>
      {node.observed_value !== null && (
        <span className="text-xs text-ink-muted">
          currently {node.observed_value}
          {node.observed_at ? ` · ${timeAgo(node.observed_at)}` : ""}
        </span>
      )}
      {node.rhs?.source === "metric" && node.observed_rhs_value != null && (
        <span className="text-xs text-ink-muted">
          vs {node.observed_rhs_value}
          {node.rhs_signal_state && node.rhs_signal_state !== "fresh"
            ? ` (${node.rhs_signal_state})`
            : ""}
        </span>
      )}
    </div>
  );
}

export function RuleSimulatePanel({ rule }: { rule: RuleResponse }) {
  const api = useApi();
  const signals = useMemo(() => {
    const seen = new Map<string, { device_id: string; metric: string }>();
    for (const leaf of leafPredicates(rule.condition)) {
      if (leaf.device_id) {
        seen.set(`${leaf.device_id}:${leaf.metric}`, {
          device_id: leaf.device_id,
          metric: leaf.metric,
        });
      }
      // A metric-vs-metric leaf's rhs is also overridable ("what if the
      // other device read X instead").
      if (leaf.rhs?.source === "metric") {
        seen.set(`${leaf.rhs.device_id}:${leaf.rhs.metric}`, {
          device_id: leaf.rhs.device_id,
          metric: leaf.rhs.metric,
        });
      }
    }
    return [...seen.values()];
  }, [rule.condition]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [showOverrides, setShowOverrides] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const now = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(localInputValue(new Date(now.getTime() - 24 * 3600 * 1000)));
  const [to, setTo] = useState(localInputValue(now));

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post<SimulateResponse>(`/rules/${rule.id}/simulate`, body));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't simulate this rule.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  function runLive() {
    const list = signals
      .filter((s) => overrides[`${s.device_id}:${s.metric}`]?.trim())
      .map((s) => ({
        device_id: s.device_id,
        metric: s.metric,
        value: Number(overrides[`${s.device_id}:${s.metric}`]),
      }))
      .filter((o) => Number.isFinite(o.value));
    void run(list.length > 0 ? { overrides: list } : {});
  }

  function runReplay() {
    void run({
      replay: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    });
  }

  const tree = result?.mode === "live" ? (result.condition as TreeNode | null) : null;

  return (
    <div className="flex flex-col gap-4">
      <Card padding="md">
        <p className="mb-3 text-sm text-ink-muted">
          Evaluate this rule against the latest readings — nothing is dispatched and no history
          row is written.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={runLive}>
            {busy ? "Simulating…" : "Run simulation"}
          </Button>
          {signals.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowOverrides((v) => !v)}
            >
              What if…
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => setShowReplay((v) => !v)}>
            Replay history
          </Button>
        </div>

        {showOverrides && (
          <div className="mt-3 flex flex-col gap-2">
            {signals.map((s) => (
              <Field key={`${s.device_id}:${s.metric}`} label={s.metric}>
                <Input
                  compact
                  type="number"
                  placeholder="live value"
                  value={overrides[`${s.device_id}:${s.metric}`] ?? ""}
                  onChange={(e) =>
                    setOverrides((o) => ({
                      ...o,
                      [`${s.device_id}:${s.metric}`]: e.target.value,
                    }))
                  }
                />
              </Field>
            ))}
          </div>
        )}

        {showReplay && (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Field label="From">
                <Input
                  compact
                  type="datetime-local"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label="To">
                <Input
                  compact
                  type="datetime-local"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
            </div>
            <div>
              <Button type="button" variant="secondary" disabled={busy} onClick={runReplay}>
                {busy ? "Replaying…" : "Replay"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {error && <ErrorState message={error} />}

      {result && (
        <Card padding="md">
          <div className="mb-3 flex items-center gap-2">
            <Badge
              tone={result.would_fire ? "online" : "unknown"}
              label={result.would_fire ? "Would fire" : "Would not fire"}
            />
            <span className="text-xs text-ink-muted">
              {result.mode === "replay" ? "over history" : "against current readings"}
            </span>
          </div>

          {tree && (
            <div className="mb-4">
              <div className={SECTION_LABEL}>Condition</div>
              <div className="mt-2">
                <ConditionTree node={tree} />
              </div>
            </div>
          )}

          {result.unavailable_signals.length > 0 && (
            <p className="mb-3 text-sm text-status-pending">
              No usable reading for{" "}
              {result.unavailable_signals.map((s) => `${s.metric} (${s.state})`).join(", ")}.
            </p>
          )}

          {result.replay && (
            <div className="mb-3 text-sm">
              <p className="text-ink">
                Would have fired {result.replay.would_have_fired_at.length}{" "}
                {result.replay.would_have_fired_at.length === 1 ? "time" : "times"} across{" "}
                {result.replay.samples} readings ({result.replay.resolution}).
                {result.replay.truncated && " History was truncated at the sample cap."}
              </p>
              {result.replay.would_have_fired_at.length > 0 && (
                <ul className="mt-1 max-h-48 overflow-y-auto text-xs text-ink-muted">
                  {result.replay.would_have_fired_at.map((t) => (
                    <li key={t} title={new Date(t).toLocaleString()}>
                      {new Date(t).toLocaleString()}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className={SECTION_LABEL}>Actions</div>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {result.actions.map((a) => (
              <li key={a.index} className="flex items-center gap-2">
                <Badge
                  tone={result.would_fire ? "online" : "unknown"}
                  variant="dot"
                  label={result.would_fire ? "would run" : "idle"}
                />
                <span className="text-ink">{a.summary}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
