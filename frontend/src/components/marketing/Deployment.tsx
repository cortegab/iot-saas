"use client";

import { useState } from "react";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { buttonClassName } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { TalkToUsDialog, type Deployment as DeploymentKind } from "./TalkToUsDialog";
import { marketingCopy } from "@/lib/marketing-copy";
import { useLocale } from "@/lib/i18n";

// Which way to run it; the words are in lib/marketing-copy.ts.
const OPTIONS: { kind: Exclude<DeploymentKind, "not_sure">; highlight?: boolean }[] = [{ kind: "cloud", highlight: true }, { kind: "dedicated" }, { kind: "on_prem" }];

/** Deployment (demo G): the three ways to run it, the comparison, and
 * "Talk to us", which emails the team (POST /public/contact). There are no
 * plan tiers. */
export function Deployment() {
  const [talk, setTalk] = useState<DeploymentKind | null>(null);
  const d = marketingCopy(useLocale()).deployment;
  const talkLabel = marketingCopy(useLocale()).nav.talk;
  const options = OPTIONS.map((o) => ({ ...o, ...d.options[o.kind] }));
  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        {options.map((o) => (
          <div
            key={o.kind}
            className={cn("flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-card", o.highlight && "border-accent ring-1 ring-accent/30")}
          >
            <h3 className="text-base font-semibold text-ink">{o.name}</h3>
            <div>
              <p className="text-[26px] font-semibold tracking-[-0.02em] text-ink">{o.big}</p>
              <p className="text-[13px] text-ink-muted">{o.sub}</p>
            </div>
            <ul className="flex flex-1 flex-col gap-1.5 text-[14px] text-ink">
              {o.points.map((p) => (
                <li key={p} className="flex gap-2">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {p}
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setTalk(o.kind)} className={cn(buttonClassName({ variant: o.highlight ? "primary" : "secondary" }), "w-full")}>
              {talkLabel}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[640px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th scope="col" className="px-4 py-2.5 font-medium">
                <span className="sr-only">{d.feature}</span>
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">{d.options.cloud.name}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{d.options.dedicated.name}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{d.options.on_prem.name}</th>
            </tr>
          </thead>
          <tbody>
            {d.compare.map(([label, ...cells]) => (
              <tr key={label} className="border-b border-border last:border-b-0">
                <th scope="row" className="whitespace-nowrap px-4 py-2.5 font-medium text-ink-muted">
                  {label}
                </th>
                {cells.map((c, i) => (
                  <td key={i} className="px-4 py-2.5 text-ink">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <p className="flex gap-3 text-[14.5px] text-ink">
          <SlidersHorizontal aria-hidden size={18} className="mt-0.5 shrink-0 text-accent" />
          <span>
            <b>{d.edgeBold}</b> {d.edge}
          </span>
        </p>
        <p className="flex gap-3 text-[14.5px] text-ink">
          <RefreshCw aria-hidden size={18} className="mt-0.5 shrink-0 text-accent" />
          <span>
            <b>{d.moveBold}</b> {d.move}
          </span>
        </p>
      </div>

      <TalkToUsDialog open={talk != null} onClose={() => setTalk(null)} deployment={talk ?? "not_sure"} />
    </>
  );
}
