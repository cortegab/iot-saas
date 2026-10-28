"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock, DoorOpen, Droplets, Fan, Plus, WifiOff, Waves } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Tag } from "@/components/ui/Badge";
import { Field } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Input";
import { RuleEditor } from "@/components/rules/editor/RuleEditor";
import { useRuleCatalog } from "@/components/rules/editor/useRuleCatalog";
import { upsertRuleInCache } from "@/lib/rule-cache";
import { emptyDraft, type RuleDraft } from "@/lib/rule-draft";
import { MAX_NAME } from "@/lib/rule-preview";
import { recipeStarts, type Recipe } from "@/lib/rule-recipes";
import { cn } from "@/lib/cn";
import { PAGE_WITH_BAR } from "@/components/editor/save-bar";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];

const ICON: Record<Recipe["icon"], typeof Fan> = { fan: Fan, door: DoorOpen, droplet: Droplets, pump: Waves, offline: WifiOff, clock: Clock };

/** New rule (DESIGN.md §9.1): name it, then start from a recipe or blank;
 * the devices are picked in the steps, since one rule can read one device and
 * switch another. `?device=<id>` (from a device page) fills that device into
 * the recipes it can run, lists them first, and returns there after saving. */
export default function NewRulePage() {
  const router = useRouter();
  const params = useSearchParams();
  const seededDevice = params.get("device") ?? undefined;
  const back = seededDevice ? `/devices/${seededDevice}?tab=rules` : "/rules";
  const catalog = useRuleCatalog();
  const { timezone } = useWorkspace();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
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

  /** A recipe (or blank) starts the steps, once the rule has a name. */
  function begin(key: string, draft: RuleDraft) {
    const n = name.trim();
    const problem = !n ? "Name the rule first." : n.length > MAX_NAME ? `Keep the name to ${MAX_NAME} characters.` : null;
    if (problem) {
      setNameError(problem);
      nameRef.current?.focus();
      return;
    }
    setStart({ key, draft: { ...structuredClone(draft), name: n } });
  }

  // A new rule opens on its own page, where it can be checked and refined (DESIGN.md §7).
  function onSaved(saved: RuleResponse) {
    upsertRuleInCache(saved);
    router.replace(`/rules/${saved.id}`);
  }

  return (
    <div className={cn("flex flex-col gap-4", start && PAGE_WITH_BAR)}>
      <PageHeader
        // The typed name becomes the title, as on every create page (DESIGN.md §4).
        title={(start ? start.draft.name : name.trim()) || "New rule"}
        breadcrumbs={[seededDevice ? { href: back, label: device?.name ?? "Device" } : { href: "/rules", label: "Rules" }]}
        description={start ? undefined : "Name it, then start from a recipe. You pick its devices in the next steps."}
      />
      {start ? (
        <RuleEditor key={start.key} deviceId={seededDevice} initialDraft={start.draft} onSaved={onSaved} onCancel={() => setStart(null)} />
      ) : (
        <div className="flex max-w-[760px] flex-col gap-4">
          <Field label="Name" error={nameError ?? undefined} hint="What it does, in a few words, e.g. Fan on when the greenhouse is hot.">
            <Input
              ref={nameRef}
              autoFocus
              value={name}
              maxLength={MAX_NAME + 1}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
            />
          </Field>
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
                <span className="text-[13px] text-ink-muted">When, If, Then, step by step.</span>
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
