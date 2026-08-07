"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { mutate as revalidate } from "swr";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import { RuleForm } from "@/components/rules/RuleForm";
import { RuleRow } from "@/components/rules/RuleRow";
import { leafPredicates } from "@/components/rules/RuleSummary";
import type { components } from "@/types/api";

type RuleWithDeviceResponse = components["schemas"]["RuleWithDeviceResponse"];

export default function RulesPage() {
  const { data: rules, error, isLoading, mutate } = useApiSWR<RuleWithDeviceResponse[]>("/rules");
  const isAdmin = useIsAdmin();
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Backend already orders by device name (rules/service.py's list_all_rules),
  // so grouping consecutive same-device rows here needs no extra sort.
  const filtered = useMemo(() => {
    if (!rules) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter(
      (r) =>
        leafPredicates(r.condition).some((leaf) => leaf.metric.toLowerCase().includes(q)) ||
        r.device_name.toLowerCase().includes(q),
    );
  }, [rules, filter]);

  const groups = useMemo(() => {
    const out: { deviceName: string; rules: RuleWithDeviceResponse[] }[] = [];
    for (const rule of filtered) {
      const last = out[out.length - 1];
      if (last && last.deviceName === rule.device_name) {
        last.rules.push(rule);
      } else {
        out.push({ deviceName: rule.device_name, rules: [rule] });
      }
    }
    return out;
  }, [filtered]);

  // A rule's own device page caches its rules under a different SWR key
  // (`/devices/{id}/rules`) — revalidate that too so it isn't left stale if
  // the user navigates there next.
  function onChanged(rule: RuleWithDeviceResponse) {
    void mutate();
    void revalidate(`/devices/${rule.device_id}/rules`);
  }

  if (isLoading) return <LoadingSkeleton rows={4} rowClassName="h-20" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load rules."}
        onRetry={() => void mutate()}
      />
    );
  }

  const editingRule = rules?.find((r) => r.id === editingId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Rules</h1>
        {/* A rule needs a device's metric behind it, so creation stays on
            the device page rather than duplicated here. */}
        <Link href="/devices" className="text-sm text-accent">
          Add rules from a device →
        </Link>
      </div>

      {rules && rules.length > 0 && (
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by metric or device…"
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-ink"
        />
      )}

      {editingRule && (
        <RuleForm
          deviceId={editingRule.device_id}
          existing={editingRule}
          onSaved={() => {
            setEditingId(null);
            onChanged(editingRule);
          }}
          onCancel={() => setEditingId(null)}
        />
      )}

      {!rules || rules.length === 0 ? (
        <EmptyState
          title="No rules yet"
          description="Rules watch a metric and fire an action when it crosses a threshold."
          action={
            <Link href="/devices" className="text-sm text-accent">
              Go to a device to add one →
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching rules" description="Try a different search term." />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.deviceName} className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                {group.deviceName}
              </h2>
              <ul className="flex flex-col gap-2">
                {group.rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    isAdmin={isAdmin}
                    deviceLink={{ href: `/devices/${rule.device_id}`, label: rule.device_name }}
                    onEdit={() => setEditingId(rule.id)}
                    onChanged={() => onChanged(rule)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
