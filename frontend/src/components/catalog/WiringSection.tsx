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
  header,
  showYield,
  hardware,
  rows,
  readOnly,
  onChange = () => undefined,
  field = () => ({ onBlur: () => undefined }),
  onRenameTarget,
  targetError,
  onKeepReading,
  guideHref,
  children,
}: {
  lead: ReactNode;
  /** Above the wiring: a device's Inherited line (the template's or its own). */
  header?: ReactNode;
  /** See HardwareSection. */
  showYield?: boolean;
  /** The wiring to show; null = none yet (offers to start one), undefined =
   * no editor at all (the host explains why in `children`). */
  hardware: HardwareDraft | null | undefined;
  rows: { metrics: KeyedRow[]; actuators: KeyedRow[] };
  readOnly: boolean;
  onChange?: (next: HardwareDraft | null) => void;
  field?: (path: string) => { error?: string; warning?: string; onBlur: () => void };
  /** A template's editor only: name a reading's metric on its part card. */
  onRenameTarget?: (kind: "inputs" | "outputs", uid: string, name: string) => void;
  targetError?: (kind: "inputs" | "outputs", uid: string) => string | undefined;
  onKeepReading?: (bindingUid: string, channel: string, keep: boolean) => void;
  /** A saved template's wiring guide page. */
  guideHref?: string;
  children?: ReactNode;
}) {
  const { data, error, isLoading } = useDriverCatalog();
  return (
    <EditorSection id="hardware" title="Wiring" lead={lead}>
      {header}
      {hardware !== undefined && (
        <HardwareSection
          hardware={hardware}
          rows={rows}
          catalog={{ data, loading: isLoading, error: !!error }}
          readOnly={readOnly}
          onChange={onChange}
          field={field}
          onRenameTarget={onRenameTarget}
          targetError={targetError}
          onKeepReading={onKeepReading}
          guideHref={guideHref}
          showYield={showYield}
        />
      )}
      {children}
    </EditorSection>
  );
}
