import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/** "No results" for a filtered list — always offers "Clear filters"
 * (DESIGN.md §6 states). */
export function NoResults({ noun, hidden, onClear }: { noun: string; hidden?: number; onClear: () => void }) {
  return (
    <EmptyState
      icon={<Search aria-hidden size={26} />}
      title={`No ${noun} match these filters`}
      description={hidden ? `${hidden} ${noun} are hidden by the current filters.` : undefined}
      action={
        <Button variant="secondary" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  );
}

/** First-use empty state for a list: why it's empty plus the primary action
 * (or who can create one, for read-only roles). */
export function FirstUse({
  icon,
  title,
  description,
  action,
  readOnlyNote,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  readOnlyNote?: string;
}) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      action={action ?? (readOnlyNote ? <p className="text-sm text-ink-muted">{readOnlyNote}</p> : undefined)}
    />
  );
}
