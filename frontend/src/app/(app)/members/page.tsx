"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import UsersSection from "./users-section";
import RolesSection from "./roles-section";

export default function MembersPage() {
  return (
    <>
      <PageHeader title="Members" description="People in this workspace and what each of them can do." />
      <UsersSection />
      <Section title="Roles">
        <RolesSection />
      </Section>
    </>
  );
}
