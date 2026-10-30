"use client";

import Link from "next/link";
import { Fragment } from "react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Callout } from "@/components/ui/Callout";
import type { components } from "@/types/api";

type AttentionResponse = components["schemas"]["AttentionResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What needs someone now (DESIGN.md §8), above every dashboard: unread
 * critical alerts, offline devices, latched rules and rules that can't
 * evaluate, each linking to its filtered list. Shown only when something
 * needs someone, so it never becomes wallpaper. Realtime revalidates it on
 * notification, device-health and rule-health events. */
export function AttentionStrip() {
  const { data } = useApiSWR<AttentionResponse>("/tenants/current/attention", { refreshInterval: 60_000 });
  if (!data) return null;
  const items = [
    { n: data.critical_alerts, text: plural(data.critical_alerts, "critical alert"), href: "/notifications?state=unread&severity=critical" },
    { n: data.offline_devices, text: `${plural(data.offline_devices, "device")} offline`, href: "/devices?status=offline" },
    { n: data.latched_rules, text: `${plural(data.latched_rules, "rule")} latched`, href: "/rules?state=latched" },
    { n: data.unhealthy_rules, text: `${plural(data.unhealthy_rules, "rule")} can't evaluate`, href: "/rules?state=stale" },
  ].filter((i) => i.n > 0);
  if (items.length === 0) return null;
  return (
    <Callout tone="warning" className="py-2.5">
      <span role="status" aria-label="Needs attention" className="flex flex-wrap items-baseline gap-x-1.5">
        <b className="font-medium">Needs attention:</b>
        {items.map((i, k) => (
          <Fragment key={i.href}>
            {k > 0 && <span aria-hidden>·</span>}
            <Link href={i.href} className="link-inline">
              {i.text}
            </Link>
          </Fragment>
        ))}
      </span>
    </Callout>
  );
}
