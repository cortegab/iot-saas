"use client";

import { useParams } from "next/navigation";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Breadcrumbs } from "@/components/ui/PageHeader";
import { TemplateEditor } from "@/components/catalog/TemplateEditor";
import type { components } from "@/types/api";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

/** A device template as a full page (DESIGN.md §7: complex records). */
export default function TemplatePage() {
  const { catalogEntryId } = useParams<{ catalogEntryId: string }>();
  const { data: entry } = useApiSWR<CatalogEntryResponse>(`/catalog/${catalogEntryId}`);
  return (
    <>
      <Breadcrumbs crumbs={[{ label: "Device templates", href: "/templates" }, { label: entry?.name ?? "Template" }]} />
      <TemplateEditor key={catalogEntryId} entryId={catalogEntryId} mode="page" dockHref={`/templates?edit=${catalogEntryId}`} />
    </>
  );
}
