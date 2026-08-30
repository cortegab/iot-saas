import type { components } from "@/types/api";

type CommandResponse = components["schemas"]["CommandResponse"];

export type CommandStatus = "confirmed" | "pending" | "no-response";

/**
 * The confirmation state shown for an actuator command.
 *
 * "no-response" is *derived*, never stored: the command's TTL window
 * (`issued_at + ttl_seconds` — the same window a device uses to reject a stale
 * command, CLAUDE.md §4) has elapsed with no ack. It is not terminal — a late
 * ack still sets `acked_at` on the row and this flips back to "confirmed" — so
 * anything rendering it should re-evaluate once the deadline passes (the value
 * of `now` it was computed with is only a snapshot).
 */
export function commandStatus(c: CommandResponse, now: number = Date.now()): CommandStatus {
  if (c.acked_at != null) return "confirmed";
  const deadlineMs = new Date(c.issued_at).getTime() + c.ttl_seconds * 1000;
  return now > deadlineMs ? "no-response" : "pending";
}

/** Milliseconds until this command's TTL deadline, or null if it is already
 * confirmed or already past the deadline — i.e. when a timer to re-render for a
 * "pending" → "no-response" transition would still be useful. */
export function msUntilCommandDeadline(c: CommandResponse, now: number = Date.now()): number | null {
  if (c.acked_at != null) return null;
  const remaining = new Date(c.issued_at).getTime() + c.ttl_seconds * 1000 - now;
  return remaining > 0 ? remaining : null;
}

const LABELS: Record<CommandStatus, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  "no-response": "No response",
};

const TONES: Record<CommandStatus, "online" | "pending" | "offline"> = {
  confirmed: "online",
  pending: "pending",
  "no-response": "offline",
};

export function commandStatusLabel(status: CommandStatus): string {
  return LABELS[status];
}

export function commandStatusTone(status: CommandStatus): "online" | "pending" | "offline" {
  return TONES[status];
}
