import type { StatusTone } from "@/components/ui/Badge";
import type { components } from "@/types/api";

export type ApiKey = components["schemas"]["ApiKeyResponse"];
export type KeyStatus = "active" | "expired" | "revoked";

/** Revoked wins over expired: it's the deliberate act. */
export function keyStatus(k: Pick<ApiKey, "revoked_at" | "expires_at">, now: number = Date.now()): KeyStatus {
  if (k.revoked_at) return "revoked";
  if (k.expires_at && new Date(k.expires_at).getTime() <= now) return "expired";
  return "active";
}

export const KEY_STATUS_LABEL: Record<KeyStatus, string> = { active: "Active", expired: "Expired", revoked: "Revoked" };
export const KEY_STATUS_TONE: Record<KeyStatus, StatusTone> = { active: "online", expired: "pending", revoked: "unknown" };
