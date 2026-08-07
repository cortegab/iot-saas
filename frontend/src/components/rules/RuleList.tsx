"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { ApiRequestError } from "@/lib/api-client";
import { RuleForm } from "@/components/rules/RuleForm";
import { RuleRow } from "@/components/rules/RuleRow";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];

export function RuleList({ deviceId }: { deviceId: string }) {
  const { data: rules, error, isLoading, mutate } = useApiSWR<RuleResponse[]>(`/devices/${deviceId}/rules`);
  const isAdmin = useIsAdmin();
  const [editingId, setEditingId] = useState<string | null>(null);

  if (isLoading) return <LoadingSkeleton rows={2} rowClassName="h-20" />;
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
    <div className="flex flex-col gap-3">
      {/* Creation lives in the device catalog view now (a rule's condition
          vocabulary comes from the device's catalog entry) — this page only
          lists and edits. */}
      {isAdmin && !editingRule && (rules?.length ?? 0) === 0 && (
        <Link href="/devices/catalog" className="text-sm text-accent">
          Create a rule from the catalog →
        </Link>
      )}

      {editingRule && (
        <RuleForm
          deviceId={deviceId}
          existing={editingRule}
          onSaved={() => {
            setEditingId(null);
            void mutate();
          }}
          onCancel={() => setEditingId(null)}
        />
      )}

      {!rules || rules.length === 0 ? (
        <EmptyState
          title="No rules yet"
          description="Rules watch a metric and fire an action when it crosses a threshold."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              isAdmin={isAdmin}
              onEdit={() => setEditingId(rule.id)}
              onChanged={() => void mutate()}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
