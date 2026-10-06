"use client";

import { useState } from "react";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { buttonClassName } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { TalkToUsDialog, type Deployment as DeploymentKind } from "./TalkToUsDialog";

const OPTIONS: { kind: DeploymentKind; name: string; big: string; sub: string; points: string[]; highlight?: boolean }[] = [
  {
    kind: "cloud",
    name: "Cloud",
    big: "Shared",
    sub: "hosted by iodriven",
    points: ["Sign up and connect devices the same day", "Updates, backups and monitoring handled for you", "Every workspace isolated by Postgres row-level security"],
    highlight: true,
  },
  {
    kind: "dedicated",
    name: "Dedicated cloud",
    big: "Single-tenant",
    sub: "operated by iodriven",
    points: ["Your own instance: database and MQTT broker not shared with anyone", "Upgrades scheduled with you", "For security reviews and compliance requirements"],
  },
  {
    kind: "on_prem",
    name: "On-premise",
    big: "Your server",
    sub: "single-tenant, run by your team",
    points: ["One Linux host with Docker Compose, sized for 500–1,000 devices", "Data never leaves your network", "Your certificates, backups and retention"],
  },
];

const COMPARE: [string, string, string, string][] = [
  ["Operated by", "iodriven", "iodriven", "Your team"],
  ["Where data lives", "iodriven cloud", "Your own instance in iodriven's cloud", "Your hardware, your network"],
  ["Isolation", "Row-level security per workspace", "Separate database and broker", "Separate everything"],
  ["Updates", "Continuous", "Scheduled with you", "You apply them"],
  ["Best for", "Getting started, many small sites", "Compliance and security reviews", "Sites that must keep data on-site"],
];

/** Deployment (demo G): the three ways to run it, the comparison, and
 * "Talk to us", which emails the team (POST /public/contact). There are no
 * plan tiers. */
export function Deployment() {
  const [talk, setTalk] = useState<DeploymentKind | null>(null);
  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        {OPTIONS.map((o) => (
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
              Talk to us
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[640px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th scope="col" className="px-4 py-2.5 font-medium" />
              <th scope="col" className="px-4 py-2.5 font-medium">Cloud</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Dedicated cloud</th>
              <th scope="col" className="px-4 py-2.5 font-medium">On-premise</th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map(([label, ...cells]) => (
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
            <b>Edge connectors, with any option.</b> Bring OPC UA, Modbus or vendor-cloud equipment through a small connector on your network. It speaks MQTT to
            the platform, so industrial servers stay off the internet.
          </span>
        </p>
        <p className="flex gap-3 text-[14.5px] text-ink">
          <RefreshCw aria-hidden size={18} className="mt-0.5 shrink-0 text-accent" />
          <span>
            <b>Move between options later.</b> The device contract is identical everywhere, so moving from Cloud to On-premise is a data migration, not a
            reflash.
          </span>
        </p>
      </div>

      <TalkToUsDialog open={talk != null} onClose={() => setTalk(null)} deployment={talk ?? "not_sure"} />
    </>
  );
}
