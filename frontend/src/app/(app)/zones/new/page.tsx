"use client";

import { Breadcrumbs } from "@/components/ui/PageHeader";
import { ZoneEditor } from "@/components/zones/ZoneEditor";

/** New zone (DESIGN.md §7: every create and edit is a full page). */
export default function NewZonePage() {
  return (
    <>
      <Breadcrumbs crumbs={[{ label: "Zones", href: "/zones" }, { label: "New" }]} />
      <ZoneEditor zoneId={null} />
    </>
  );
}
