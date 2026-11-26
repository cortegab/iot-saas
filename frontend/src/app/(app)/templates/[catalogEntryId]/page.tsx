"use client";

import { useParams } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/PageHeader";
import { TemplateEditor } from "@/components/catalog/TemplateEditor";
import { tActive as tr } from "@iodriven/shared/i18n";

/** A device template as a full page (DESIGN.md §7: complex records). */
export default function TemplatePage() {
  const { catalogEntryId } = useParams<{ catalogEntryId: string }>();
  return (
    <>
      <Breadcrumbs crumbs={[{ label: tr("tlist.title"), href: `/templates?peek=${catalogEntryId}` }]} />
      <TemplateEditor key={catalogEntryId} entryId={catalogEntryId} />
    </>
  );
}
