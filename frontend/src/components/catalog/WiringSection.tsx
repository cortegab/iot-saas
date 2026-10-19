"use client";

import type { ReactNode } from "react";
import { HardwareSection } from "@/components/catalog/HardwareSection";
import { EditorSection } from "@/components/editor/EditorFrame";
import { useDriverCatalog } from "@/lib/hardware/driver-catalog";
import type { HardwareDraft, KeyedRow } from "@/lib/hardware/hardware-draft";

/** The one Wiring section (DESIGN.md §8), for a template and for a device's
 * own wiring alike: the board and its parts, from the published firmware's
 * catalog, then whatever the host adds below (`children`). */
export function WiringSection({
  lead,
  card = false,
  hardware,
  rows,
  readOnly,
  onChange = () => undefined,
  field = () => ({ onBlur: () => undefined }),
  children,
}: {
  lead: ReactNode;
  card?: boolean;
  /** The wiring to show; null = none yet (offers to start one), undefined =
   * no editor at all (the host explains why in `children`). */
  hardware: HardwareDraft | null | undefined;
  rows: { metrics: KeyedRow[]; actuators: KeyedRow[] };
  readOnly: boolean;
  onChange?: (next: HardwareDraft | null) => void;
  field?: (path: string) => { error?: string; warning?: string; onBlur: () => void };
  children?: ReactNode;
}) {
  const { data, error, isLoading } = useDriverCatalog();
  return (
    <EditorSection id="hardware" title="Wiring" card={card} lead={lead}>
      {hardware !== undefined && (
        <HardwareSection hardware={hardware} rows={rows} catalog={{ data, loading: isLoading, error: !!error }} readOnly={readOnly} onChange={onChange} field={field} />
      )}
      {children}
    </EditorSection>
  );
}
