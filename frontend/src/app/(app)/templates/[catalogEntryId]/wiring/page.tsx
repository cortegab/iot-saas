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

type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

/** A template's wiring guide on its own page (demo H): the pin table and the
 * notes, to print or keep open while wiring the board. */
export default function WiringGuidePage() {
  const { catalogEntryId } = useParams<{ catalogEntryId: string }>();
  const { data: entry, error, isLoading, mutate } = useApiSWR<CatalogEntryResponse>(`/catalog/${catalogEntryId}`);
  const { data: catalog, isLoading: catalogLoading } = useDriverCatalog();

  const crumbs = [
    { label: "Device templates", href: "/templates" },
    { label: entry?.name ?? "Template", href: `/templates/${catalogEntryId}` },
  ];
  if (error) {
    return <ErrorState message={error instanceof ApiRequestError ? error.message : "Couldn't load this template."} onRetry={() => void mutate()} />;
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
        title="Wiring guide"
        description="Print it or keep it open while you wire the board."
        actions={
          guide && guide.pins.length > 0 ? (
            <Button variant="secondary" className="print:hidden" onClick={() => window.print()}>
              <Printer aria-hidden size={15} />
              Print
            </Button>
          ) : undefined
        }
      />
      {!guide || guide.pins.length === 0 ? (
        <EmptyState
          title="Nothing to wire yet"
          description={`${entry.name} has no parts on a board, so there's no wiring to follow.`}
          action={
            <Link href={`/templates/${catalogEntryId}?tab=wiring`} className={buttonClassName({ variant: "secondary" })}>
              Set up its wiring
            </Link>
          }
        />
      ) : (
        <>
          <GuideTable guide={{ ...guide, board: null, notes: [] }} />
          <section className="flex flex-col gap-2">
            <h2 className="text-section font-semibold text-ink">Notes</h2>
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
