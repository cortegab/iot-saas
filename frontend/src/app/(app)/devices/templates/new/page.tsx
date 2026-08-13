"use client";

import { useSearchParams } from "next/navigation";
import { useApiSWR } from "@/hooks/useApiSWR";
import { CatalogEntryForm } from "@/components/catalog/CatalogEntryForm";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import type { components } from "@/types/api";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

/** Duplicate (spec §7) lands here with `?duplicate=<id>` — the source
 * entry's name/metrics/actuators seed the form, but id/status/is_legacy
 * don't carry over, so this is still a real POST /catalog on submit. */
export default function NewCatalogEntryPage() {
  const duplicateId = useSearchParams().get("duplicate");
  const { data: source, isLoading } = useApiSWR<CatalogEntryResponse>(
    duplicateId ? `/catalog/${duplicateId}` : null,
  );

  if (duplicateId && isLoading) return <LoadingSkeleton rows={3} rowClassName="h-12" />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={duplicateId ? `Duplicate "${source?.name}"` : "Create template"}
        back={{ href: "/devices/templates", label: "Device Templates" }}
      />
      <CatalogEntryForm mode="create" initial={source} />
    </div>
  );
}
