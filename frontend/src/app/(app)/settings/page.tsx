"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { ThemeToggle } from "@/components/nav/ThemeToggle";
import WorkspaceSection from "./workspace-section";
import AlertsSection from "./alerts-section";

/** Workspace settings as one page (DESIGN.md §8). It becomes a record editor
 * with the save bar once the editor chrome lands. */
export default function WorkspaceSettingsPage() {
  return (
    <>
      <PageHeader title="Workspace settings" description="Name, alert recipients and your own account." />
      <WorkspaceSection />
      <div id="alerts" className="scroll-mt-6">
        <AlertsSection />
      </div>
      <Section title="Appearance">
        <div className="max-w-sm rounded-xl border border-border bg-surface shadow-card">
          <ThemeToggle />
        </div>
      </Section>
    </>
  );
}
