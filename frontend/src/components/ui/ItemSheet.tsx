"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Button, IconButton } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";

/**
 * DESIGN.md §7 item sheet: one child item of the record being edited (a part,
 * metric, actuator, condition, action, widget). It edits the page's draft
 * live, so it has **Done** and never a save of its own; the page's save bar
 * saves. From the right, 560px; from the bottom on phones.
 */
export function ItemSheet({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** A muted line under the title ("Metric", "Part · its readings feed…"). */
  sub?: ReactNode;
  children: ReactNode;
  /** Replaces the default footer (Done). Put Done rightmost. */
  footer?: ReactNode;
}) {
  const phone = useMediaQuery("(max-width: 640px)");
  return (
    <Sheet open={open} onClose={onClose} label={title} side={phone ? "bottom" : "right"} widthClassName="w-[min(560px,100vw)]">
      <div className="flex shrink-0 items-start gap-2 border-b border-border-soft py-3.5 pl-5 pr-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold text-ink">{title}</h2>
          {sub && <p className="text-[13px] text-ink-muted">{sub}</p>}
        </div>
        <IconButton aria-label="Close" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="@container min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-soft px-5 py-3">
        {footer ?? (
          <Button onClick={onClose}>Done</Button>
        )}
      </div>
    </Sheet>
  );
}
