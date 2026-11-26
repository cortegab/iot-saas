"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Printer } from "lucide-react";
import { useApiSWR } from "@/hooks/useApiSWR";
import { Button, buttonClassName } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { GuideTable } from "@/components/catalog/HardwareSection";
import { ApiRequestError } from "@/lib/api-client";
import { resolveModel } from "@/lib/hardware/board-pins";
import { useDriverCatalog } from "@/lib/hardware/driver-catalog";
import { hardwareToDraft, wiringGuide, type KeyedRow } from "@/lib/hardware/hardware-draft";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

/** A template's wiring guide on its own page (demo H): the pin table and the
 * notes, to print or keep open while wiring the board. */
export default function WiringGuidePage() {
  const { catalogEntryId } = useParams<{ catalogEntryId: string }>();
  const { data: entry, error, isLoading, mutate } = useApiSWR<CatalogEntryResponse>(`/catalog/${catalogEntryId}`);
  const { data: catalog, isLoading: catalogLoading } = useDriverCatalog();

  const crumbs = [
    { label: tr("tlist.title"), href: "/templates" },
    { label: entry?.name ?? tr("wguide.template"), href: `/templates/${catalogEntryId}` },
  ];
  if (error) {
    return <ErrorState message={error instanceof ApiRequestError ? error.message : tr("wguide.loadFailed")} onRetry={() => void mutate()} />;
  }
  if (isLoading || catalogLoading || !entry) return <LoadingSkeleton rows={5} rowClassName="h-10" />;

  const rows: { metrics: KeyedRow[]; actuators: KeyedRow[] } = {
    metrics: entry.metrics.map((m) => ({ uid: wireId(m), key: wireId(m), name: m.name, type: m.data_type ?? "float" })),
    actuators: entry.actuators.map((a) => ({ uid: wireId(a), key: wireId(a), name: a.name, type: a.value_type ?? "bool" })),
  };
  const draft = hardwareToDraft(entry.hardware, rows);
  const guide = draft ? wiringGuide(draft, rows, catalog) : null;
  const board = draft ? (resolveModel(catalog?.models, draft.board)?.label ?? draft.board) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={crumbs}
        eyebrow={board}
        title={tr("wguide.title")}
        description={tr("wguide.description")}
        actions={
          guide && guide.pins.length > 0 ? (
            <Button variant="secondary" className="print:hidden" onClick={() => window.print()}>
              <Printer aria-hidden size={15} />
              {tr("wguide.print")}
            </Button>
          ) : undefined
        }
      />
      {!guide || guide.pins.length === 0 ? (
        <EmptyState
          title={tr("wguide.emptyTitle")}
          description={tr("wguide.emptyBody", { template: entry.name })}
          action={
            <Link href={`/templates/${catalogEntryId}?tab=wiring`} className={buttonClassName({ variant: "secondary" })}>
              {tr("wguide.setUp")}
            </Link>
          }
        />
      ) : (
        <>
          <GuideTable guide={{ ...guide, board: null, notes: [] }} />
          <section className="flex flex-col gap-2">
            <h2 className="text-section font-semibold text-ink">{tr("wguide.notes")}</h2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-muted">
              {guide.notes.map((n) =>
                n.lines.map((line) => (
                  <li key={n.driver + line}>
                    <b className="font-medium text-ink">{n.driver}:</b> {line}
                  </li>
                )),
              )}
              {guide.board?.lines.map((line) => (
                <li key={line}>
                  <b className="font-medium text-ink">{guide.board!.label}:</b> {line}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
