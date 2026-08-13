"use client";

import { useParams } from "next/navigation";
import { useApiSWR } from "@/hooks/useApiSWR";
import { CatalogEntryForm } from "@/components/catalog/CatalogEntryForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

export default function EditCatalogEntryPage() {
  const params = useParams<{ catalogEntryId: string }>();
  const { data: entry, error, isLoading, mutate } = useApiSWR<CatalogEntryResponse>(
    `/catalog/${params.catalogEntryId}`,
  );

  if (isLoading) return <LoadingSkeleton rows={4} rowClassName="h-12" />;
  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiRequestError ? error.message : "Couldn't load this template."}
        onRetry={() => void mutate()}
      />
    );
  }
  if (!entry) return <EmptyState title="Template not found" />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={entry.name}
        subtitle={entry.is_legacy ? "Legacy / Uncategorized" : undefined}
        back={{ href: "/devices/templates", label: "Device Templates" }}
      />
      <CatalogEntryForm mode="edit" initial={entry} />
    </div>
  );
}
