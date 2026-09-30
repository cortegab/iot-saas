"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { buttonClassName } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { FailedActionsList } from "@/components/rules/FailedActionsList";
import { RulesTabs } from "@/components/rules/RulesTabs";

export default function FailedActionsPage() {
  const { can } = usePermissions();
  return (
    <>
      <PageHeader
        title="Rules"
        description="Evaluated in memory the moment a reading arrives. Breach to actuator command is typically under 500 ms."
        actions={
          can("rules.write") ? (
            <Link href="/rules/new" className={buttonClassName()}>
              <Plus aria-hidden size={15} />
              New rule
            </Link>
          ) : null
        }
      />
      <RulesTabs active="failed" />
      <FailedActionsList />
    </>
  );
}
