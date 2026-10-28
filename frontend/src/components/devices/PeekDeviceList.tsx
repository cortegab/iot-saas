"use client";

import Link from "next/link";
import { useApiSWR } from "@/hooks/useApiSWR";
import { DeviceStatusPill } from "@/components/ui/ConnectionBadge";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PeekSection } from "@/components/editor/PeekFrame";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];

const SHOWN = 5;

/** The devices behind a template or zone, inside its peek: the first few as
 * rows with their status, then "All N devices" to the filtered list. */
export function PeekDeviceList({ match, allHref }: { match: (d: DeviceResponse) => boolean; allHref: string }) {
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const mine = (devices ?? []).filter(match);
  if (devices && mine.length === 0) return null;

  return (
    <PeekSection title="Devices">
      {!devices ? (
        <LoadingSkeleton rows={2} rowClassName="h-6" />
      ) : (
        <>
          <ul aria-label="Devices" className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
            {mine.slice(0, SHOWN).map((d) => (
              <li key={d.id} className="flex min-h-11 items-center justify-between gap-3 border-t border-border-soft px-3.5 py-2 text-sm first:border-t-0">
                <Link href={`/devices/${d.id}`} className="truncate font-medium text-ink hover:underline hover:underline-offset-[3px]">
                  {d.name}
                </Link>
                <DeviceStatusPill device={d} />
              </li>
            ))}
          </ul>
          {mine.length > SHOWN && (
            <Link href={allHref} className="w-fit text-sm text-accent hover:underline">
              All {mine.length} devices
            </Link>
          )}
        </>
      )}
    </PeekSection>
  );
}
