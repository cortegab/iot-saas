"use client";

import { useParams, useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { useApiSWR } from "@/hooks/useApiSWR";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { RuleForm } from "@/components/rules/RuleForm";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type DeviceResponse = components["schemas"]["DeviceResponse"];

export default function EditRulePage() {
  const params = useParams<{ ruleId: string }>();
  const router = useRouter();
  const { data: rule, error, isLoading, mutate } = useApiSWR<RuleResponse>(`/rules/${params.ruleId}`);
  const { data: device } = useApiSWR<DeviceResponse>(rule ? `/devices/${rule.device_id}` : null);

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

  function onSaved() {
    if (!rule) return;
    void revalidate("/rules");
    void revalidate(`/devices/${rule.device_id}/rules`);
    router.push("/rules");
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Edit rule"
        subtitle={device ? `on ${device.name}` : undefined}
        back={{ href: "/rules", label: "Rules" }}
      />

      <RuleForm deviceId={rule.device_id} existing={rule} onSaved={onSaved} onCancel={() => router.push("/rules")} />
    </div>
  );
}
