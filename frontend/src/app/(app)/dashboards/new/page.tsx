"use client";

import { Breadcrumbs } from "@/components/ui/PageHeader";
import { DashboardEditor } from "@/components/dashboards/DashboardEditor";
import { tActive as tr } from "@iodriven/shared/i18n";

/** New dashboard (DESIGN.md §7: every create is a full page). Creating it
 * opens the dashboard in Edit layout to add widgets. */
export default function NewDashboardPage() {
  return (
    <>
      <Breadcrumbs crumbs={[{ label: tr("nav.dashboards"), href: "/dashboards" }]} />
      <DashboardEditor />
    </>
  );
}
