"use client";

import { useParams } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/PageHeader";
import { TemplateEditor } from "@/components/catalog/TemplateEditor";

/** A device template as a full page (DESIGN.md §7: complex records). */
export default function TemplatePage() {
  const { catalogEntryId } = useParams<{ catalogEntryId: string }>();
  return (
    <>
      <Breadcrumbs crumbs={[{ label: "Device templates", href: `/templates?peek=${catalogEntryId}` }]} />
      <TemplateEditor key={catalogEntryId} entryId={catalogEntryId} />
    </>
  );
}
