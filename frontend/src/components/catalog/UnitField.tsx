"use client";

import { useMemo } from "react";
import { Combobox, type ComboboxGroup } from "@/components/ui/Combobox";
import { UNIT_CATEGORIES, unitLabel } from "@/lib/units";

/** The Metrics-tab Unit field: the `Combobox` bound to the categorized unit
 * catalog, but with `allowCustomValue` so an author can still type a unit
 * that isn't listed (and so pre-existing free-text units keep working). The
 * stored value is the bare symbol; `unitLabel` renders it as "symbol — name"
 * on the trigger, or verbatim when it isn't a catalog symbol. */
export function UnitField({
  value,
  onChange,
  className,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
}) {
  const groups = useMemo<ComboboxGroup[]>(
    () =>
      UNIT_CATEGORIES.map((category) => ({
        label: category.category,
        options: category.units.map((unit) => ({
          value: unit.symbol,
          label: unit.symbol,
          hint: unit.name,
        })),
      })),
    [],
  );

  return (
    <Combobox
      ariaLabel="Unit"
      value={value ?? ""}
      onChange={(next) => onChange(next || null)}
      groups={groups}
      allowCustomValue
      maxLength={32}
      placeholder="Unit, e.g. °C"
      searchPlaceholder="Search units…"
      emptyLabel="No matching units"
      renderValue={unitLabel}
      className={className}
    />
  );
}
