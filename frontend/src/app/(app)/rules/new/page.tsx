"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, Clock, DoorOpen, Droplets, Fan, Plus, WifiOff, Waves } from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Tag } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { QuickRecipe } from "@/components/rules/editor/QuickRecipe";
import { RuleEditor } from "@/components/rules/editor/RuleEditor";
import { useRuleCatalog } from "@/components/rules/editor/useRuleCatalog";
import { upsertRuleInCache } from "@/lib/rule-cache";
import { contacts, emptyDraft, type ActuatorActionDraft, type RuleDraft } from "@/lib/rule-draft";
import { recipeStarts, type Recipe } from "@/lib/rule-recipes";
import { cn } from "@/lib/cn";
import { PAGE_WITH_BAR } from "@/components/editor/save-bar";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];

const ICON: Record<Recipe["icon"], typeof Fan> = { fan: Fan, door: DoorOpen, droplet: Droplets, pump: Waves, offline: WifiOff, clock: Clock, bell: Bell };

/** New rule (DESIGN.md §9.1): start from a recipe or blank. A recipe opens as
 * one screen (its blanks, the sentence, Create); Customize, or Start blank,
 * opens the steps, named on Review (a recipe suggests a name). The devices are picked in the steps, since one rule can read one device and
 * switch another. `?device=<id>` (from a device page) fills that device into
 * the recipes it can run, lists them first, and returns there after saving. */
export default function NewRulePage() {
  const router = useRouter();
  const params = useSearchParams();
  const seededDevice = params.get("device") ?? undefined;
  const back = seededDevice ? `/devices/${seededDevice}?tab=rules` : "/rules";
  const catalog = useRuleCatalog();
  const { timezone } = useWorkspace();
  const [start, setStart] = useState<{ key: string; draft: RuleDraft; recipe?: Recipe } | null>(null);
  const isAdmin = useIsAdmin();

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

  // A shortcut from a reading or a control (ease-of-use B2):
  // ?recipe=<id>&device=<id>&metric=<key> fills the reading (and a limit inside
  // its range); &actuatorDevice=<id>&actuator=<key> fills the output. It opens
  // the recipe's one screen once, when the devices have loaded.
  const recipeParam = params.get("recipe");
  const prefilled = useRef(false);
  useEffect(() => {
    if (!recipeParam || prefilled.current || catalog.devices.length === 0) return;
    // Wait for the named devices' templates too, or the fields would stay blank.
    const known = (id: string | null) => !id || catalog.metricOptionsFor(id).length + catalog.actuatorOptionsFor(id).length > 0;
    if (!known(seededDevice ?? null) || !known(params.get("actuatorDevice"))) return;
    const recipe = recipes.find((r) => r.id === recipeParam);
    if (!recipe) return;
    prefilled.current = true;
    const draft = structuredClone(recipe.draft);
    const metric = params.get("metric");
    const leaf = contacts(draft.condition)[0];
    if (leaf && seededDevice && metric && catalog.metricOptionsFor(seededDevice).some((o) => o.id === metric)) {
      leaf.deviceId = seededDevice;
      leaf.metric = metric;
      const meta = catalog.metricFor(seededDevice, metric);
      if (meta?.min != null && meta.max != null && meta.max > meta.min && leaf.rhsKind === "static" && meta.data_type !== "bool") {
        leaf.value = Math.round(meta.min + (meta.max - meta.min) * (leaf.operator.startsWith("<") ? 0.25 : 0.75));
      }
    }
    if (draft.when.type === "device_status" && seededDevice) draft.when.statusDeviceId = seededDevice;
    const actuatorDevice = params.get("actuatorDevice");
    const actuator = params.get("actuator");
    const output = draft.actions.find((a): a is ActuatorActionDraft => a.kind === "actuator");
    if (output && actuatorDevice && actuator && catalog.actuatorOptionsFor(actuatorDevice).some((o) => o.id === actuator)) {
      output.deviceId = actuatorDevice;
      output.actuator = actuator;
    }
    setStart({ key: `${recipe.id}:prefill`, draft, recipe });
  }, [recipeParam, recipes, catalog, seededDevice, params]);

  /** A recipe opens its one screen; blank (or Customize) opens the steps. */
  function begin(key: string, draft: RuleDraft, recipe?: Recipe) {
    setStart({ key, draft: structuredClone(draft), recipe });
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
        description={start ? undefined : "Start from a recipe or blank. A recipe asks only for its devices and limit."}
      />
      {!isAdmin ? (
        <p className="max-w-[760px] rounded-lg bg-surface-raised px-3 py-2 text-meta text-ink-muted">
          Only owners and admins create rules. Ask one to add it.
        </p>
      ) : start?.recipe ? (
        <QuickRecipe
          key={start.key}
          recipe={start.recipe}
          initialDraft={start.draft}
          onSaved={onSaved}
          onBack={() => {
            setStart(null);
            // Drop a shortcut's prefill so the recipes stay put.
            if (recipeParam) router.replace(seededDevice ? `/rules/new?device=${seededDevice}` : "/rules/new");
          }}
          onCustomize={(draft) => setStart({ key: `${start.key}:full`, draft })}
        />
      ) : start ? (
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
                    onClick={() => begin(r.id, r.draft, r)}
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
