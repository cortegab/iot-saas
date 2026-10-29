"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock, DoorOpen, Droplets, Fan, Plus, WifiOff, Waves } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Tag } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { RuleEditor } from "@/components/rules/editor/RuleEditor";
import { useRuleCatalog } from "@/components/rules/editor/useRuleCatalog";
import { upsertRuleInCache } from "@/lib/rule-cache";
import { emptyDraft, type RuleDraft } from "@/lib/rule-draft";
import { recipeStarts, type Recipe } from "@/lib/rule-recipes";
import { cn } from "@/lib/cn";
import { PAGE_WITH_BAR } from "@/components/editor/save-bar";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];

const ICON: Record<Recipe["icon"], typeof Fan> = { fan: Fan, door: DoorOpen, droplet: Droplets, pump: Waves, offline: WifiOff, clock: Clock };

/** New rule (DESIGN.md §9.1): start from a recipe or blank, then the steps,
 * named on Review (a recipe suggests a name). The devices are picked in the steps, since one rule can read one device and
 * switch another. `?device=<id>` (from a device page) fills that device into
 * the recipes it can run, lists them first, and returns there after saving. */
export default function NewRulePage() {
  const router = useRouter();
  const params = useSearchParams();
  const seededDevice = params.get("device") ?? undefined;
  const back = seededDevice ? `/devices/${seededDevice}?tab=rules` : "/rules";
  const catalog = useRuleCatalog();
  const { timezone } = useWorkspace();
  const [start, setStart] = useState<{ key: string; draft: RuleDraft } | null>(null);

  const device = seededDevice ? catalog.devices.find((d) => d.id === seededDevice) : undefined;
  const recipes = useMemo(
    () =>
      recipeStarts(
        timezone,
        device && {
          id: device.id,
          name: device.name,
          metrics: catalog.metricOptionsFor(device.id).map((o) => ({ ...catalog.metricFor(device.id, o.id)!, key: o.id })),
          actuators: catalog.actuatorOptionsFor(device.id).map((o) => ({ ...catalog.actuatorFor(device.id, o.id)!, key: o.id })),
        },
      ),
    [device, catalog, timezone],
  );

  /** A recipe (or blank) starts the steps. */
  function begin(key: string, draft: RuleDraft) {
    setStart({ key, draft: structuredClone(draft) });
  }

  // A new rule opens on its own page, where it can be checked and refined (DESIGN.md §7).
  function onSaved(saved: RuleResponse) {
    upsertRuleInCache(saved);
    router.replace(`/rules/${saved.id}`);
  }

  return (
    <div className={cn("flex flex-col gap-4", start && PAGE_WITH_BAR)}>
      <PageHeader
        title="New rule"
        breadcrumbs={[seededDevice ? { href: back, label: device?.name ?? "Device" } : { href: "/rules", label: "Rules" }]}
        description={start ? undefined : "Start from a recipe or blank. You pick its devices and name it in the next steps."}
      />
      {start ? (
        <RuleEditor key={start.key} deviceId={seededDevice} initialDraft={start.draft} onSaved={onSaved} onCancel={() => setStart(null)} />
      ) : (
        <div className="flex max-w-[760px] flex-col gap-4">
          <ul aria-label="Recipes" className="grid gap-3 sm:grid-cols-2">
            {recipes.map((r) => {
              const Icon = ICON[r.icon];
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => begin(r.id, r.draft)}
                    className="flex h-full w-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-left shadow-card hover:border-[color-mix(in_srgb,var(--color-accent)_50%,var(--color-border))]"
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon aria-hidden size={18} className="shrink-0 text-accent" />
                      <strong className="text-sm font-semibold text-ink">{r.title}</strong>
                    </span>
                    <span className="text-meta text-ink-muted">{r.description}</span>
                    {r.tags.length > 0 && (
                      <span className="mt-auto flex flex-wrap gap-1.5 pt-1">
                        {r.tags.map((t) => (
                          <Tag key={t} tone={t === "switches hardware" ? "warn" : "neutral"} size="sm">
                            {t}
                          </Tag>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={() => begin("blank", emptyDraft(seededDevice ?? "", timezone))}
                className="flex h-full min-h-[96px] w-full flex-col items-start gap-2 rounded-xl border border-dashed border-border bg-surface p-4 text-left hover:border-accent"
              >
                <span className="flex items-center gap-2.5">
                  <Plus aria-hidden size={18} className="shrink-0 text-ink-muted" />
                  <strong className="text-sm font-semibold text-ink">Start blank</strong>
                </span>
                <span className="text-meta text-ink-muted">When, If, Then, step by step.</span>
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
