import type { ReactNode } from "react";
import { Link2, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** A value that follows another record's unless overridden (DESIGN.md §5
 * Inherited): a device's wiring from its template, a rule email's recipients
 * from the workspace. One line says which it is, with the switch; the value
 * (read-only while it follows, editable once it's its own) sits below. */
export function Inherited({
  from,
  what,
  overridden,
  readOnly = false,
  overrideLabel,
  resetLabel,
  onOverride,
  onReset,
  disabled = false,
  note,
  actions,
  children,
}: {
  /** Whose value it follows, as read in a sentence ("the template", "ESP32 Inputs"). */
  from: ReactNode;
  /** What is inherited ("wiring", "recipients"). */
  what: string;
  overridden: boolean;
  readOnly?: boolean;
  /** "Wire this device differently", "Use different recipients". */
  overrideLabel: string;
  /** "Use the template's wiring", "Use the workspace's". */
  resetLabel: string;
  onOverride: () => void;
  onReset: () => void;
  /** The switch can't be used yet (e.g. what it copies is still loading). */
  disabled?: boolean;
  /** A second sentence on the state line (what overriding means). */
  note?: ReactNode;
  /** More buttons beside the switch. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const Icon = overridden ? Link2Off : Link2;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex min-w-0 flex-1 basis-[260px] items-start gap-2 text-meta text-ink">
          <Icon aria-hidden size={15} className="mt-0.5 shrink-0 text-ink-muted" />
          <span>
            {overridden ? (
              <>
                <b className="font-medium">Its own {what}</b>, instead of {from}&apos;s.
              </>
            ) : (
              <>
                <b className="font-medium">Follows {from}&apos;s {what}.</b>
              </>
            )}
            {note && <span className="text-ink-muted"> {note}</span>}
          </span>
        </p>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={overridden ? onReset : onOverride}>
              {overridden ? resetLabel : overrideLabel}
            </Button>
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
