"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { draftFromRule } from "@/lib/rule-draft";
import { useRuleCatalog } from "@/components/rules/editor/useRuleCatalog";
import type { components } from "@/types/api";
import { LadderRung } from "./LadderRung";

type RuleResponse = components["schemas"]["RuleResponse"];

/** Every rule as a numbered, read-only rung ("segment") — the whole rule
 * set at a glance, like a PLC program listing. Click a segment to edit it. */
export function LadderOverview({ rules }: { rules: RuleResponse[] }) {
  const catalog = useRuleCatalog();
  const drafts = useMemo(() => rules.map((r) => ({ rule: r, draft: draftFromRule(r) })), [rules]);

  return (
    <div className="flex flex-col gap-3">
      {drafts.map(({ rule, draft }, i) => (
        <Card key={rule.id} padding="md" className={rule.enabled ? undefined : "opacity-60"}>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-ink-muted">SEGMENT {i + 1}</span>
              <Link href={`/rules/${rule.id}`} className="text-sm font-medium text-ink hover:text-accent">
                {rule.name}
              </Link>
              {!rule.enabled && <Badge tone="unknown" variant="dot" label="Disabled" />}
              {rule.latched && <Badge tone="pending" variant="dot" label="Latched" />}
              {rule.enabled && !rule.health.evaluatable && (
                <Badge tone="pending" variant="dot" label="Can't evaluate" />
              )}
            </div>
            <Link
              href={`/rules/${rule.id}`}
              aria-label={`Edit ${rule.name}`}
              className="-mx-1 block overflow-x-auto rounded-lg px-1 pb-1 hover:bg-surface-raised"
            >
              <LadderRung draft={draft} catalog={catalog} ariaLabel={`Ladder for ${rule.name}`} />
            </Link>
          </div>
        </Card>
      ))}
    </div>
  );
}
