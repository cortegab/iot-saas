import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Status tones (DESIGN.md §3 status vocabulary). `accent` is for the rule
 * "Fired" state only; everything else resolves to a `status-*` token. */
export type StatusTone = "online" | "offline" | "unknown" | "pending" | "error" | "accent";
export type BadgeVariant = "text" | "dot" | "pill" | "indicator";
/** Dot shape — status is never colour alone. `hollow` = never connected,
 * `square` = disabled / latched. */
export type DotShape = "solid" | "hollow" | "square";

const TONE_CLASSES: Record<StatusTone, { dot: string; ring: string; text: string; pillBg: string }> = {
  online: {
    dot: "bg-status-online",
    ring: "ring-status-online",
    text: "text-status-online",
    pillBg: "bg-status-online/13",
  },
  offline: {
    dot: "bg-status-offline",
    ring: "ring-status-offline",
    text: "text-status-offline",
    pillBg: "bg-status-offline/13",
  },
  unknown: {
    dot: "bg-status-unknown",
    ring: "ring-status-unknown",
    text: "text-ink-muted",
    pillBg: "bg-status-unknown/13",
  },
  pending: {
    dot: "bg-status-pending",
    ring: "ring-status-pending",
    text: "text-status-pending",
    pillBg: "bg-status-pending/13",
  },
  error: {
    dot: "bg-status-error",
    ring: "ring-status-error",
    text: "text-status-error",
    pillBg: "bg-status-error/13",
  },
  accent: { dot: "bg-accent", ring: "ring-accent", text: "text-accent-strong", pillBg: "bg-accent/13" },
};

function Dot({ tone, shape = "solid", className }: { tone: StatusTone; shape?: DotShape; className?: string }) {
  const cfg = TONE_CLASSES[tone];
  return (
    <span
      aria-hidden
      className={cn(
        "h-[7px] w-[7px] shrink-0",
        shape === "square" ? "rounded-[2px]" : "rounded-full",
        shape === "hollow" ? cn("bg-transparent ring-2 ring-inset", cfg.ring) : cfg.dot,
        className,
      )}
    />
  );
}

export interface BadgeProps {
  tone: StatusTone;
  label: string;
  /** `pill` (default) — tinted chip with a dot (DESIGN.md §5). `dot` — dot +
   * coloured label, no fill. `text` — coloured label only. `indicator` — bare
   * dot for a presence marker beside content that names itself. */
  variant?: BadgeVariant;
  shape?: DotShape;
  className?: string;
}

export function Badge({ tone, label, variant = "pill", shape = "solid", className }: BadgeProps) {
  const cfg = TONE_CLASSES[tone];

  if (variant === "indicator") {
    return <Dot tone={tone} shape={shape} className={cn("h-2 w-2", className)} />;
  }

  if (variant === "text") {
    return <span className={cn("text-sm", cfg.text, className)}>{label}</span>;
  }

  if (variant === "dot") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
        <Dot tone={tone} shape={shape} />
        <span className={cfg.text}>{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-0.5 pl-[7px] pr-2 text-xs font-medium",
        cfg.pillBg,
        cfg.text,
        className,
      )}
    >
      <Dot tone={tone} shape={shape} />
      {label}
    </span>
  );
}

export type TagTone = "neutral" | "warn" | "accent";

/** A non-status label (DESIGN.md §5 Tag): `warn` for conflicts ("shares
 * fan1"), `sm` for qualifiers ("expert"), `mono` for key chips. */
export function Tag({
  children,
  tone = "neutral",
  size = "md",
  mono = false,
  className,
}: {
  children: ReactNode;
  tone?: TagTone;
  size?: "sm" | "md";
  mono?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap font-medium",
        size === "sm" ? "rounded px-[5px] text-[10.5px]" : "rounded-[6px] px-2 py-px text-xs",
        // Key chips (metric/actuator keys) keep a hairline border and mono face.
        mono && "rounded border border-border px-1.5 font-mono text-[11.5px] font-normal",
        tone === "neutral" && "bg-surface-raised text-ink",
        tone === "warn" && "bg-status-pending-surface text-status-pending",
        tone === "accent" && "bg-accent-muted text-accent-strong",
        className,
      )}
    >
      {children}
    </span>
  );
}
