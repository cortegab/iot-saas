import { ApiRequestError } from "@iodriven/shared/api-client";
import type { components } from "@iodriven/shared/api";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { useRouter, type Href } from "expo-router";
import { useSWRConfig } from "swr";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Platform } from "react-native";
import { isNotificationsKey } from "@/alerts/notifications";
import { useAuth } from "@/auth/AuthProvider";
import { api } from "@/lib/api";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { DEFAULT_SETTINGS, parseSettings, pushedAlert, routeFor, type MinSeverity, type PushSettings } from "./routes";

type PushDeviceResponse = components["schemas"]["PushDeviceResponse"];
type AlertGroup = components["schemas"]["NotificationGroupResponse"];
type Permission = "granted" | "denied" | "undetermined";

const ASKED = "iodriven.push.asked";
const settingsKey = (tenantId: string) => `iodriven.push.${tenantId}`;

// Alerts arriving while the app is open still show, like any other.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Android channels, matching the sender's channel_id (docs/mobile-push.md):
 * the phone's own settings can then mute warnings but keep critical alerts. */
async function ensureChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("critical", {
    name: "Critical alerts",
    description: "A device went offline, or another critical alert.",
    importance: AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync("alerts", {
    name: "Alerts",
    description: "Rules that fired, and other warnings.",
    importance: AndroidImportance.DEFAULT,
  });
}

interface PushContextValue {
  permission: Permission;
  settings: PushSettings;
  /** Turns alerts on for this workspace, asking for permission if needed. */
  setEnabled: (enabled: boolean) => Promise<void>;
  setMinSeverity: (min: MinSeverity) => Promise<void>;
  /** Before sign-out: this phone stops receiving every workspace's alerts. */
  unregisterAll: () => Promise<void>;
  error: string | null;
}

const PushContext = createContext<PushContextValue | null>(null);

export function usePush(): PushContextValue {
  const ctx = useContext(PushContext);
  if (!ctx) throw new Error("usePush outside PushProvider");
  return ctx;
}

/** Push notifications for the signed-in app (docs/mobile-push.md, DESIGN.md
 * §15): one registration per workspace this phone has opened, kept current
 * when FCM rotates the token; taps open the alert's device or Alerts. */
export function PushProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { accessToken, currentTenantId, memberships, setCurrentTenantId } = useAuth();
  const [permission, setPermission] = useState<Permission>("undetermined");
  const [settings, setSettings] = useState<PushSettings>(DEFAULT_SETTINGS);
  const [explain, setExplain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  const save = useCallback(async (tenantId: string, next: PushSettings) => {
    setSettings(next);
    await SecureStore.setItemAsync(settingsKey(tenantId), JSON.stringify(next));
  }, []);

  /** Registers (or refreshes) this phone in a workspace with its FCM token. */
  const register = useCallback(
    async (tenantId: string, current: PushSettings, deviceToken?: string): Promise<PushSettings> => {
      const token = deviceToken ?? (await Notifications.getDevicePushTokenAsync()).data;
      const res = await api.put<PushDeviceResponse>(
        "/me/push-devices",
        { accessToken: tokenRef.current, tenantId },
        { token: String(token), platform: Platform.OS === "ios" ? "ios" : "android", min_severity: current.minSeverity, enabled: current.enabled },
      );
      return { id: res.id, enabled: res.enabled, minSeverity: res.min_severity };
    },
    [],
  );

  // Channels once; permission and this workspace's settings on each switch.
  useEffect(() => {
    void ensureChannels();
  }, []);

  useEffect(() => {
    if (!currentTenantId) return;
    let cancelled = false;
    void (async () => {
      const perm = (await Notifications.getPermissionsAsync()).status as Permission;
      const stored = parseSettings(await SecureStore.getItemAsync(settingsKey(currentTenantId)));
      if (cancelled) return;
      setPermission(perm);
      setSettings(stored);
      if (perm === "granted" && stored.enabled) {
        try {
          const next = await register(currentTenantId, stored);
          if (!cancelled) await save(currentTenantId, next);
        } catch (err) {
          // Offline, or push not configured on this build: try again next time.
          console.warn("push registration failed:", err instanceof Error ? err.message : String(err));
        }
      } else if (perm === "undetermined" && !(await SecureStore.getItemAsync(ASKED))) {
        if (!cancelled) setExplain(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentTenantId, register, save]);

  // FCM can rotate the token: re-register in this workspace.
  useEffect(() => {
    const sub = Notifications.addPushTokenListener((t) => {
      if (!currentTenantId || permission !== "granted" || !settings.enabled) return;
      void register(currentTenantId, settings, String(t.data))
        .then((next) => save(currentTenantId, next))
        .catch(() => undefined);
    });
    return () => sub.remove();
  }, [currentTenantId, permission, settings, register, save]);

  const { mutate } = useSWRConfig();

  /** Opening a notification reads its alert, as opening it in Alerts does:
   * the whole alert (its repeats too) when it's found, else just this one.
   * Best effort: a failure leaves it unread, nothing else. */
  const markRead = useCallback(
    async (data: Record<string, unknown>, tenantId: string | null) => {
      const pushed = pushedAlert(data);
      if (!pushed || !tenantId) return;
      const ctx = { accessToken: tokenRef.current, tenantId };
      try {
        const groups = await api.get<AlertGroup[]>(pushed.groupsQuery, ctx);
        const group = groups.find((g) => g.latest.id === pushed.notificationId);
        if (group) await api.post(`/notifications/groups/${encodeURIComponent(group.key)}/read`, ctx);
        else await api.patch(`/notifications/${pushed.notificationId}/read`, ctx);
      } catch (err) {
        console.warn("couldn't mark the tapped alert read:", err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  // A tap, also the one that started the app.
  const open = useCallback(
    (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, unknown>;
      const target = routeFor(data);
      const tenantId = target.tenantId && memberships.some((m) => m.tenant_id === target.tenantId) ? target.tenantId : currentTenantId;
      void markRead(data, tenantId).then(() => {
        // Same workspace: its badge and list update now. Another workspace
        // starts with an empty cache, so it loads after the read anyway.
        if (tenantId === currentTenantId) void mutate(isNotificationsKey);
      });
      if (tenantId && tenantId !== currentTenantId) setCurrentTenantId(tenantId);
      router.push(target.href as Href);
    },
    [currentTenantId, markRead, memberships, mutate, router, setCurrentTenantId],
  );
  useEffect(() => {
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) {
        open(r);
        void Notifications.clearLastNotificationResponseAsync();
      }
    });
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
    // The cold-start tap is handled once; later taps use the listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (!currentTenantId) return;
      setError(null);
      let perm = permission;
      if (enabled && perm !== "granted") {
        perm = (await Notifications.requestPermissionsAsync()).status as Permission;
        setPermission(perm);
        await SecureStore.setItemAsync(ASKED, "1");
        if (perm !== "granted") return;
      }
      const next = { ...settings, enabled };
      try {
        await save(currentTenantId, enabled || settings.id ? await register(currentTenantId, next) : next);
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : "Couldn't update notifications. Check your connection and try again.");
      }
    },
    [currentTenantId, permission, settings, register, save],
  );

  const setMinSeverity = useCallback(
    async (minSeverity: MinSeverity) => {
      if (!currentTenantId) return;
      setError(null);
      const next = { ...settings, minSeverity };
      try {
        await save(currentTenantId, permission === "granted" && settings.enabled ? await register(currentTenantId, next) : next);
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : "Couldn't update notifications. Check your connection and try again.");
      }
    },
    [currentTenantId, permission, settings, register, save],
  );

  const unregisterAll = useCallback(async () => {
    await Promise.all(
      memberships.map(async (m) => {
        const stored = parseSettings(await SecureStore.getItemAsync(settingsKey(m.tenant_id)));
        if (stored.id) {
          await api.delete(`/me/push-devices/${stored.id}`, { accessToken: tokenRef.current, tenantId: m.tenant_id }).catch(() => undefined);
        }
        await SecureStore.deleteItemAsync(settingsKey(m.tenant_id));
      }),
    );
  }, [memberships]);

  const value = useMemo(
    () => ({ permission, settings, setEnabled, setMinSeverity, unregisterAll, error }),
    [permission, settings, setEnabled, setMinSeverity, unregisterAll, error],
  );

  return (
    <PushContext.Provider value={value}>
      {children}
      {/* Asked once, after sign-in, with the reason first (DESIGN.md §15). */}
      <Sheet
        open={explain}
        onClose={() => {
          setExplain(false);
          void SecureStore.setItemAsync(ASKED, "1");
        }}
        title="Get alerts on this phone?"
        footer={
          <>
            <Button
              label="Turn on alerts"
              onPress={() => {
                setExplain(false);
                void setEnabled(true);
              }}
            />
            <Button
              label="Not now"
              variant="secondary"
              onPress={() => {
                setExplain(false);
                void SecureStore.setItemAsync(ASKED, "1");
              }}
            />
          </>
        }
      >
        <Text>
          IO Driven can tell you when a device goes offline or a rule fires, even when the app is closed. You choose critical only or warnings too, in More.
        </Text>
        <Text size="meta" color="inkMuted">
          Alerts show device and rule names only, never readings.
        </Text>
      </Sheet>
    </PushContext.Provider>
  );
}

/** Opens the phone's settings for this app (notifications turned off there). */
export const openAppSettings = () => void Linking.openSettings();
