"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { RuleForm } from "@/components/rules/RuleForm";
import { upsertRuleInCache } from "@/lib/rule-cache";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];

export default function NewRulePage() {
  const router = useRouter();

  function onSaved(saved: RuleResponse) {
    upsertRuleInCache(saved);
    router.push("/rules");
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Add rule" back={{ href: "/rules", label: "Rules" }} />
      <RuleForm onSaved={onSaved} onCancel={() => router.push("/rules")} />
    </div>
  );
}
