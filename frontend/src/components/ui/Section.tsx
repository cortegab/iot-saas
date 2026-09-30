import type { ReactNode } from "react";

/** A titled group of content within a page or editor (DESIGN.md §3: section
 * headings are 15–16px, weight 600, sentence case). */
export function Section({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {description && <p className="mt-0.5 max-w-[64ch] text-[13.5px] text-ink-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}
