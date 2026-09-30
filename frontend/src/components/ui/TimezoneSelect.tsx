"use client";

import { forwardRef, useMemo } from "react";
import { Select, type SelectProps } from "@/components/ui/Select";
import { timezoneOptions } from "@/lib/timezones";

export interface TimezoneSelectProps extends Omit<SelectProps, "value" | "onChange" | "children"> {
  value: string;
  onChange: (zone: string) => void;
}

/** DESIGN.md §9.6 — the one time zone select: IANA values labelled
 * "City (GMT±h)", grouped by region. A stored zone that isn't in the list is
 * still shown as selected. */
export const TimezoneSelect = forwardRef<HTMLSelectElement, TimezoneSelectProps>(function TimezoneSelect(
  { value, onChange, ...props },
  ref,
) {
  const { extra, groups } = useMemo(() => timezoneOptions(value), [value]);
  return (
    <Select ref={ref} value={value} onChange={(e) => onChange(e.target.value)} {...props}>
      {extra && <option value={extra.value}>{extra.label}</option>}
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
});
