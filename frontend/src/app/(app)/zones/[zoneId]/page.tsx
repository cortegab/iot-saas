"use client";

import { useParams } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/PageHeader";
import { ZoneEditor } from "@/components/zones/ZoneEditor";
import { tActive as tr } from "@iodriven/shared/i18n";

/** A zone's page (DESIGN.md §7): the list peeks, this edits. The crumb goes
 * back to the list with this zone peeked. */
export default function ZonePage() {
  const { zoneId } = useParams<{ zoneId: string }>();
  return (
    <>
      <Breadcrumbs crumbs={[{ label: tr("nav.zones"), href: `/zones?peek=${zoneId}` }]} />
      <ZoneEditor key={zoneId} zoneId={zoneId} />
    </>
  );
}
