"use client";

import { useParams, useRouter } from "next/navigation";
import { useApiSWR } from "@/hooks/useApiSWR";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { RuleForm } from "@/components/rules/RuleForm";
import { ApiRequestError } from "@/lib/api-client";
import { upsertRuleInCache } from "@/lib/rule-cache";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type DeviceResponse = components["schemas"]["DeviceResponse"];

function primaryInputDevice(rule: RuleResponse): string | undefined {
  return (rule.devices.find((d) => d.role === "input") ?? rule.devices[0])?.device_id;
}

export default function EditRulePage() {
  const params = useParams<{ ruleId: string }>();
  const router = useRouter();
  const { data: rule, error, isLoading, mutate } = useApiSWR<RuleResponse>(`/rules/${params.ruleId}`);
  const seedDevice = rule ? primaryInputDevice(rule) : undefined;
  const { data: device } = useApiSWR<DeviceResponse>(seedDevice ? `/devices/${seedDevice}` : null);

  if (isLoading) return <LoadingSkeleton rows={4} rowClassName="h-12" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load this rule."}
        onRetry={() => void mutate()}
      />
    );
  }
  if (!rule) return <EmptyState title="Rule not found" />;

  function onSaved(saved: RuleResponse) {
    upsertRuleInCache(saved);
    router.push("/rules");
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Edit rule"
        subtitle={
          device ? `on ${device.name}` : rule.devices.length > 1 ? "multi-device" : undefined
        }
        back={{ href: "/rules", label: "Rules" }}
      />

      <RuleForm
        deviceId={seedDevice}
        existing={rule}
        onSaved={onSaved}
        onCancel={() => router.push("/rules")}
      />
    </div>
  );
}
