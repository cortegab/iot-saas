"use client";

import { useParams } from "next/navigation";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Breadcrumbs } from "@/components/ui/PageHeader";
import { ZoneEditor } from "@/components/zones/ZoneEditor";
import type { components } from "@/types/api";

type ZoneResponse = components["schemas"]["ZoneResponse"];

/** A zone's page (DESIGN.md §7): the list peeks, this edits. The crumb goes
 * back to the list with this zone peeked. */
export default function ZonePage() {
  const { zoneId } = useParams<{ zoneId: string }>();
  const { data: zone } = useApiSWR<ZoneResponse>(`/zones/${zoneId}`);
  return (
    <>
      <Breadcrumbs crumbs={[{ label: "Zones", href: `/zones?peek=${zoneId}` }, { label: zone?.name ?? "Zone" }]} />
      <ZoneEditor key={zoneId} zoneId={zoneId} />
    </>
  );
}
