"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, Clock, DoorOpen, Droplets, Fan, Plus, WifiOff, Waves } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Tag } from "@/components/ui/Badge";
import { Field } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { RuleEditor } from "@/components/rules/editor/RuleEditor";
import { useRuleCatalog } from "@/components/rules/editor/useRuleCatalog";
import { upsertRuleInCache } from "@/lib/rule-cache";
import type { RuleDraft } from "@/lib/rule-draft";
import { recipesFor, unavailableRecipes, type Recipe } from "@/lib/rule-recipes";
import { cn } from "@/lib/cn";
import { PAGE_WITH_BAR } from "@/components/editor/save-bar";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];

const ICON: Record<Recipe["icon"], typeof Fan> = { fan: Fan, door: DoorOpen, droplet: Droplets, pump: Waves, offline: WifiOff, clock: Clock };

/** New rule (DESIGN.md §9.1): recipe cards generated from what the chosen
 * device can do, or Start blank; then the workbench. `?device=<id>` (from a
 * device page) preselects the device and returns there after saving. */
export default function NewRulePage() {
  const router = useRouter();
  const params = useSearchParams();
  const seededDevice = params.get("device") ?? undefined;
  const back = seededDevice ? `/devices/${seededDevice}?tab=rules` : "/rules";
  const catalog = useRuleCatalog();
  const { timezone } = useWorkspace();
  const [deviceId, setDeviceId] = useState(seededDevice ?? "");
  const [start, setStart] = useState<{ key: string; draft?: RuleDraft } | null>(null);

  const device = catalog.devices.find((d) => d.id === (deviceId || catalog.devices[0]?.id));
  const recipes = useMemo(() => {
    if (!device) return [];
    return recipesFor(
      {
        id: device.id,
        name: device.name,
        metrics: catalog.metricOptionsFor(device.id).map((o) => ({ ...catalog.metricFor(device.id, o.id)!, key: o.id })),
        actuators: catalog.actuatorOptionsFor(device.id).map((o) => ({ ...catalog.actuatorFor(device.id, o.id)!, key: o.id })),
      },
      timezone,
    );
  }, [device, catalog, timezone]);

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
        description={start ? undefined : "Pick the device, then start from a recipe. Everything stays editable."}
      />
      {start ? (
        <RuleEditor key={start.key} deviceId={device?.id} initialDraft={start.draft} onSaved={onSaved} onCancel={() => setStart(null)} />
      ) : (
        <>
          <Field label="Device" hint="Recipes come from what it measures and switches." className="max-w-sm">
            <Select value={device?.id ?? ""} onChange={(e) => setDeviceId(e.target.value)} disabled={catalog.devices.length === 0}>
              {catalog.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <ul aria-label="Recipes" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {recipes.map((r) => {
              const Icon = ICON[r.icon];
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setStart({ key: r.id, draft: structuredClone(r.draft) })}
                    className="flex h-full w-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-left shadow-card hover:border-[color-mix(in_srgb,var(--color-accent)_50%,var(--color-border))]"
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon aria-hidden size={18} className="shrink-0 text-accent" />
                      <strong className="text-sm font-semibold text-ink">{r.title}</strong>
                    </span>
                    <span className="text-[13px] text-ink-muted">{r.description}</span>
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
            {/* What this device can't run, and what it would need (demo H). */}
            {device &&
              unavailableRecipes(recipes).map((r) => {
                const Icon = ICON[r.icon];
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      className="flex h-full w-full cursor-not-allowed flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-left opacity-60"
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon aria-hidden size={18} className="shrink-0 text-accent" />
                        <strong className="text-sm font-semibold text-ink">{r.title}</strong>
                      </span>
                      <span className="text-[13px] text-ink-muted">{r.why}</span>
                    </button>
                  </li>
                );
              })}
            <li>
              <button
                type="button"
                onClick={() => setStart({ key: "blank" })}
                className={cn(
                  "flex h-full min-h-[96px] w-full flex-col items-start gap-2 rounded-xl border border-dashed border-border bg-surface p-4 text-left hover:border-accent",
                )}
              >
                <span className="flex items-center gap-2.5">
                  <Plus aria-hidden size={18} className="shrink-0 text-ink-muted" />
                  <strong className="text-sm font-semibold text-ink">Start blank</strong>
                </span>
                <span className="text-[13px] text-ink-muted">When, If, Then, step by step.</span>
              </button>
            </li>
          </ul>
          {catalog.devices.length === 0 && (
            <p className="flex items-center gap-2 text-[13px] text-ink-muted">
              <Bell aria-hidden size={14} />
              Add a device first to get recipes for it; a blank rule works without one.
            </p>
          )}
        </>
      )}
    </div>
  );
}
