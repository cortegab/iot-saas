"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { draftFromRule } from "@/lib/rule-draft";
import { RULE_STATE, ruleStateKey } from "@/lib/rule-text";
import { useRuleCatalog } from "@/components/rules/editor/useRuleCatalog";
import type { components } from "@/types/api";
import { ResponsiveRung } from "./LadderRung";
import { tActive as tr } from "@iodriven/shared/i18n";

type RuleResponse = components["schemas"]["RuleResponse"];

/** Every rule as a numbered, read-only rung ("segment") — the whole rule
 * set at a glance, like a PLC program listing. Cards in a grid, as many
 * across as fit at 460px or more (DESIGN.md §6). Click one to edit it. */
export function LadderOverview({ rules }: { rules: RuleResponse[] }) {
  const catalog = useRuleCatalog();
  const drafts = useMemo(() => rules.map((r) => ({ rule: r, draft: draftFromRule(r) })), [rules]);

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,460px),1fr))] gap-3.5">
      {drafts.map(({ rule, draft }, i) => (
        <Card key={rule.id} padding="md" className={rule.enabled ? undefined : "text-ink-muted"}>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-ink-muted">SEGMENT {i + 1}</span>
              <Link href={`/rules/${rule.id}`} className="text-sm font-medium text-ink hover:text-accent">
                {rule.name}
              </Link>
              {/* One state per rule, as everywhere (only Armed goes unsaid here). */}
              {ruleStateKey(rule) !== "armed" && (
                <Badge tone={RULE_STATE[ruleStateKey(rule)].tone} shape={RULE_STATE[ruleStateKey(rule)].shape} variant="dot" label={RULE_STATE[ruleStateKey(rule)].label} />
              )}
            </div>
            <Link
              href={`/rules/${rule.id}`}
              aria-label={tr("ladder.editRule", { name: rule.name })}
              className="-mx-1 block rounded-lg px-1 pb-1 hover:bg-surface-raised"
            >
              <ResponsiveRung fit draft={draft} catalog={catalog} ariaLabel={tr("ladder.ladderFor", { name: rule.name })} />
            </Link>
          </div>
        </Card>
      ))}
    </div>
  );
}
