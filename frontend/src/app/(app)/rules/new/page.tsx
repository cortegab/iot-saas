"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { RuleEditor } from "@/components/rules/editor/RuleEditor";
import { upsertRuleInCache } from "@/lib/rule-cache";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];

/** `?device=<id>` (from a device's Rules tab) seeds the first condition and
 * action with that device and returns there afterwards. */
export default function NewRulePage() {
  const router = useRouter();
  const deviceId = useSearchParams().get("device") ?? undefined;
  const back = deviceId ? `/devices/${deviceId}?tab=rules` : "/rules";

  function onSaved(saved: RuleResponse) {
    upsertRuleInCache(saved);
    router.push(back);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Add rule" back={{ href: back, label: deviceId ? "Device" : "Rules" }} />
      <RuleEditor deviceId={deviceId} onSaved={onSaved} onCancel={() => router.push(back)} />
    </div>
  );
}
