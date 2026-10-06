"use client";

import { useSearchParams } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/PageHeader";
import { TemplateEditor } from "@/components/catalog/TemplateEditor";

/** New device template (full page, numbered rail). `?duplicate=<id>` seeds
 * it from an existing template; it's still a new record on save. */
export default function NewTemplatePage() {
  const duplicateId = useSearchParams().get("duplicate");
  return (
    <>
      <Breadcrumbs crumbs={[{ label: "Device templates", href: "/templates" }, { label: duplicateId ? "Duplicate" : "New" }]} />
      <TemplateEditor key={duplicateId ?? "new"} entryId={null} duplicateOf={duplicateId} mode="page" />
    </>
  );
}
