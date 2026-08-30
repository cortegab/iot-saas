import type { ReactNode } from "react";

/** A titled group of content within a page — the pattern the settings pages
 * repeated locally. The label uses the one section-label recipe documented in
 * globals.css (`text-xs font-medium uppercase tracking-wide text-ink-muted`). */
export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-ink-muted">{title}</h2>
      {children}
    </section>
  );
}
