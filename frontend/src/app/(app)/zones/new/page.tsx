"use client";

import { Breadcrumbs } from "@/components/ui/PageHeader";
import { ZoneEditor } from "@/components/zones/ZoneEditor";
import { tActive as tr } from "@iodriven/shared/i18n";

/** New zone (DESIGN.md §7: every create and edit is a full page). */
export default function NewZonePage() {
  return (
    <>
      <Breadcrumbs crumbs={[{ label: tr("nav.zones"), href: "/zones" }]} />
      <ZoneEditor zoneId={null} />
    </>
  );
}
