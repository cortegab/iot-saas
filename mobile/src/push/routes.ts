/** Where tapping a push notification goes (docs/mobile-push.md): a device
 * that went offline or needs a look opens the device; everything else opens Alerts. The
 * workspace comes with it, so a tap from another workspace switches first. */
export interface PushTarget {
  tenantId: string | null;
  href: string;
}

export function routeFor(data: Record<string, unknown> | null | undefined): PushTarget {
  const str = (k: string) => (typeof data?.[k] === "string" && data[k] ? (data[k] as string) : null);
  const tenantId = str("tenant_id");
  const deviceId = str("device_id");
  if ((str("kind") === "device_offline" || str("kind") === "device_health") && deviceId) return { tenantId, href: `/devices/${deviceId}` };
  return { tenantId, href: "/alerts" };
}

export type MinSeverity = "critical" | "warning";

/** The phone's choice, per workspace, as the More screen shows it. */
export interface PushSettings {
  /** The registration's id on the platform, once registered. */
  id: string | null;
  enabled: boolean;
  minSeverity: MinSeverity;
}

export const DEFAULT_SETTINGS: PushSettings = { id: null, enabled: true, minSeverity: "warning" };

export function parseSettings(raw: string | null): PushSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const v = JSON.parse(raw) as Partial<PushSettings>;
    return {
      id: typeof v.id === "string" ? v.id : null,
      enabled: v.enabled !== false,
      minSeverity: v.minSeverity === "critical" ? "critical" : "warning",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** The alert a tapped notification is about, to mark it read: its id, and
 * the groups query that finds its alert (unread, from the same device or
 * rule). Null when the payload has no notification id. */
export function pushedAlert(data: Record<string, unknown> | null | undefined): { notificationId: string; groupsQuery: string } | null {
  const str = (k: string) => (typeof data?.[k] === "string" && data[k] ? (data[k] as string) : null);
  const notificationId = str("notification_id");
  if (!notificationId) return null;
  const q = new URLSearchParams({ unread: "true", limit: "100" });
  const deviceId = str("device_id");
  const ruleId = str("rule_id");
  if (deviceId) q.set("device_id", deviceId);
  if (ruleId) q.set("rule_id", ruleId);
  return { notificationId, groupsQuery: `/notifications/groups?${q.toString()}` };
}
