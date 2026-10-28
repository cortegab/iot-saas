"use client";

import { useParams } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/PageHeader";
import { ZoneEditor } from "@/components/zones/ZoneEditor";

/** A zone's page (DESIGN.md §7): the list peeks, this edits. The crumb goes
 * back to the list with this zone peeked. */
export default function ZonePage() {
  const { zoneId } = useParams<{ zoneId: string }>();
  return (
    <>
      <Breadcrumbs crumbs={[{ label: "Zones", href: `/zones?peek=${zoneId}` }]} />
      <ZoneEditor key={zoneId} zoneId={zoneId} />
    </>
  );
}
