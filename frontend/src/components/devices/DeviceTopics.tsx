"use client";

import { CopyField } from "@/components/ui/SecretReveal";
import { useAuthContext } from "@/lib/auth-context";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

/** MQTT topics are built from slugs, not display names — a device's slug is
 * fixed at creation, so this answers "what do I actually publish to?". */
export function DeviceTopics({ device, template }: { device: DeviceResponse; template?: CatalogEntryResponse }) {
  const { memberships, currentTenantId } = useAuthContext();
  const tenantSlug = memberships.find((m) => m.tenant_id === currentTenantId)?.tenant_slug;
  if (!tenantSlug) return null;
  const subtree = `${tenantSlug}/${device.slug}`;
  const rows: [string, string][] = [
    ...(template?.metrics ?? []).map((m): [string, string] => [`Telemetry · ${m.name}`, `${subtree}/${wireId(m)}`]),
    ...(template?.actuators ?? []).flatMap((a): [string, string][] => [
      [`Command · ${a.name}`, `${subtree}/cmd/${wireId(a)}`],
      [`Desired state · ${a.name} (retained)`, `${subtree}/state/${wireId(a)}`],
      [`Acknowledgement · ${a.name}`, `${subtree}/ack/${wireId(a)}`],
    ]),
    ["Health (retained, last will)", `${subtree}/status`],
  ];
  return (
    <dl className="flex flex-col gap-2">
      {rows.map(([label, topic]) => (
        <div key={topic} className="flex flex-col gap-1">
          <dt className="text-xs text-ink-muted">{label}</dt>
          <dd>
            <CopyField value={topic} label="topic" />
          </dd>
        </div>
      ))}
    </dl>
  );
}
