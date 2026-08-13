"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Card } from "@/components/ui/Card";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { RuleForm } from "@/components/rules/RuleForm";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];

export default function NewRulePage() {
  const router = useRouter();
  const { data: devices, isLoading } = useApiSWR<DeviceResponse[]>("/devices");
  const [deviceId, setDeviceId] = useState("");

  function onSaved() {
    void revalidate("/rules");
    void revalidate(`/devices/${deviceId}/rules`);
    router.push("/rules");
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Add rule" back={{ href: "/rules", label: "Rules" }} />

      <Card className="max-w-sm">
        <label className="flex max-w-sm flex-col gap-1 text-sm text-ink-muted">
          Device
          <Select required value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="" disabled>
              {isLoading ? "Loading…" : "Choose a device…"}
            </option>
            {devices?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </label>

        {isLoading && <LoadingSkeleton rows={2} rowClassName="h-12" />}
      </Card>

      {deviceId && (
        <RuleForm deviceId={deviceId} onSaved={onSaved} onCancel={() => router.push("/rules")} />
      )}
    </div>
  );
}
