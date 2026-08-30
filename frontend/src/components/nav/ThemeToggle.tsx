"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "@/hooks/useTheme";
import { cn } from "@/lib/cn";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/** Theme preference control for the account menu. Renders the "System" option
 * as active until mounted so the markup can't disagree with the server. */
export function ThemeToggle() {
  const { preference, setPreference, mounted } = useTheme();
  const active = mounted ? preference : "system";

  return (
    <div className="px-3 py-2">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-muted">
        Theme
      </span>
      <div role="radiogroup" aria-label="Theme" className="flex gap-0.5 rounded-md bg-surface-raised p-0.5">
        {OPTIONS.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active === value}
            onClick={() => setPreference(value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
              active === value ? "bg-surface text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon aria-hidden size={14} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
