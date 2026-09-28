"use client";

export interface TabItem {
  id: string;
  label: string;
  disabled?: boolean;
  /** Shown as a native title tooltip on hover when `disabled`. */
  disabledReason?: string;
}

/** Controlled tab strip — the caller owns active-tab state (often mirrored
 * into a query param) and renders the matching panel itself, so this stays a
 * pure nav control with no content-switching logic of its own. */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" aria-label="Sections" className="flex gap-1 border-b border-border">
      {tabs.map((tab) => {
        if (tab.disabled) {
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              disabled
              aria-selected={false}
              aria-disabled="true"
              title={tab.disabledReason}
              id={`tab-${tab.id}`}
              className="-mb-px cursor-not-allowed border-b-2 border-transparent px-3 py-2 text-sm font-medium text-ink-muted/50"
            >
              {tab.label}
            </button>
          );
        }
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 ${
              selected
                ? "border-accent text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  id,
  active,
  children,
}: {
  id: string;
  active: string;
  children: React.ReactNode;
}) {
  if (id !== active) return null;
  return (
    <div role="tabpanel" id={`tabpanel-${id}`} aria-labelledby={`tab-${id}`} className="flex flex-col gap-4 pt-4">
      {children}
    </div>
  );
}
