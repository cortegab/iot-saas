"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { FailedActionsList } from "@/components/rules/FailedActionsList";

export default function FailedActionsPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Failed actions"
        subtitle="Deliveries that couldn't complete — webhooks, emails, unreachable actuators."
        back={{ href: "/rules", label: "Rules" }}
      />
      <FailedActionsList />
    </div>
  );
}
