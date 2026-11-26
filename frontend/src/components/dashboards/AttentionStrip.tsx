"use client";

import Link from "next/link";
import { Fragment } from "react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Callout } from "@/components/ui/Callout";
import type { components } from "@/types/api";
import { tActive as t } from "@iodriven/shared/i18n";

type AttentionResponse = components["schemas"]["AttentionResponse"];


/** What needs someone now (DESIGN.md §8), above every dashboard: unread
 * critical alerts, offline devices, latched rules and rules that can't
 * evaluate, each linking to its filtered list. Shown only when something
 * needs someone, so it never becomes wallpaper. Realtime revalidates it on
 * notification, device-health and rule-health events. */
export function AttentionStrip() {
  const { data } = useApiSWR<AttentionResponse>("/tenants/current/attention", { refreshInterval: 60_000 });
  if (!data) return null;
  const items = [
    { n: data.critical_alerts, text: t("dashboards.criticalAlarms", { count: data.critical_alerts }), href: "/notifications?state=active&severity=critical" },
    { n: data.offline_devices, text: t("dashboards.devicesOffline", { count: data.offline_devices }), href: "/devices?status=offline" },
    { n: data.latched_rules, text: t("dashboards.rulesLatched", { count: data.latched_rules }), href: "/rules?state=latched" },
    { n: data.unhealthy_rules, text: t("dashboards.rulesStale", { count: data.unhealthy_rules }), href: "/rules?state=stale" },
  ].filter((i) => i.n > 0);
  if (items.length === 0) return null;
  return (
    <Callout tone="warning" className="py-2.5">
      <span role="status" aria-label={t("dashboards.attention")} className="flex flex-wrap items-baseline gap-x-1.5">
        <b className="font-medium">{t("dashboards.attentionLead")}</b>
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
