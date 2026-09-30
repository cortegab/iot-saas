"use client";

import { useRouter } from "next/navigation";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Tabs } from "@/components/ui/Tabs";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];
type FailedActionResponse = components["schemas"]["FailedActionResponse"];

/** "Rules · Failed deliveries" tabs shared by /rules and /rules/failed-actions
 * (demo G rules page). */
export function RulesTabs({ active }: { active: "rules" | "failed" }) {
  const router = useRouter();
  const { data: rules } = useApiSWR<RuleResponse[]>("/rules");
  const { data: failed } = useApiSWR<FailedActionResponse[]>("/rules/failed-actions");
  return (
    <Tabs
      ariaLabel="Rule views"
      active={active}
      onChange={(id) => router.push(id === "failed" ? "/rules/failed-actions" : "/rules")}
      tabs={[
        { id: "rules", label: "Rules", count: rules?.length },
        {
          id: "failed",
          label: "Failed deliveries",
          count: failed && failed.length > 0 ? failed.length : undefined,
          alert: true,
        },
      ]}
    />
  );
}
