"use client";

import type { ReactNode } from "react";
import { useEditorNav } from "@/components/editor/EditorFrame";

export interface ReviewRow {
  label: string;
  value: ReactNode;
  /** The step that edits it; shows a **Change** link. */
  step?: string;
}

/** A wizard's Review step (DESIGN.md §5): what will be created, one row per
 * fact, each with a Change link back to its step. */
export function ReviewList({ rows }: { rows: ReviewRow[] }) {
  const nav = useEditorNav();
  return (
    <dl className="flex flex-col rounded-xl border border-border bg-surface px-5 py-1 shadow-card">
      {rows.map((r) => (
        <div
          key={r.label}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-t border-border-soft py-3.5 first:border-t-0 @min-[521px]:grid-cols-[140px_minmax(0,1fr)_auto]"
        >
          <dt className="col-span-full text-[13px] text-ink-muted @min-[521px]:col-span-1">{r.label}</dt>
          <dd className="min-w-0 text-sm text-ink">{r.value}</dd>
          {r.step && nav ? (
            <button
              type="button"
              onClick={() => nav.goTo(r.step!)}
              className="text-[13px] font-medium text-accent hover:underline"
            >
              Change<span className="sr-only"> {r.label.toLowerCase()}</span>
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
    </dl>
  );
}
