import { ROLE_LABEL, toRole } from "@iodriven/shared/permissions";
import type { components } from "@iodriven/shared/api";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { Check, ExternalLink } from "lucide-react-native";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { useApiSWR } from "@/hooks/useApiSWR";
import { openAppSettings, usePush } from "@/push/PushProvider";
import { apiUrl, webUrl } from "@/lib/config";
import { useTheme } from "@/theme/useTheme";
import { Button } from "@/ui/Button";
import { Lines, Row } from "@/ui/Row";
import { Segmented } from "@/ui/Segmented";
import { Switch } from "@/ui/Switch";
import { Text } from "@/ui/Text";

type UserResponse = components["schemas"]["UserResponse"];

const roleLabel = (role: string) => {
  const r = toRole(role);
  return r ? ROLE_LABEL[r] : role;
};

/** Account, workspace switching, what stays on the web, and sign-out. */
export default function More() {
  const theme = useTheme();
  const { memberships, currentTenantId, setCurrentTenantId, logout } = useAuth();
  const { data: me } = useApiSWR<UserResponse>("/auth/me");
  const push = usePush();

  function confirmSignOut() {
    Alert.alert("Sign out?", "You'll need your email and password to sign in again on this phone.", [
      { text: "Cancel", style: "cancel" },
      // The phone stops receiving this account's alerts before the session ends.
      { text: "Sign out", style: "destructive", onPress: () => void push.unregisterAll().finally(() => void logout()) },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Lines label="Account">
        <Row title={me?.name || me?.email || "…"} detail={me?.name ? me.email : undefined} />
      </Lines>

      <Lines label="Workspace">
        {memberships.map((m) => (
          <Row
            key={m.tenant_id}
            title={m.tenant_name}
            detail={roleLabel(m.role)}
            selected={m.tenant_id === currentTenantId}
            accessibilityLabel={`${m.tenant_name}, ${roleLabel(m.role)}`}
            onPress={() => setCurrentTenantId(m.tenant_id)}
            right={m.tenant_id === currentTenantId ? <Check size={20} color={theme.accent} /> : null}
          />
        ))}
      </Lines>

      <Lines label="Notifications">
        <Row
          title="Alerts on this phone"
          detail={
            push.permission === "denied"
              ? "Notifications are off for IO Driven in the phone's settings."
              : push.settings.enabled && push.permission === "granted"
                ? "For this workspace. Device and rule names only, never readings."
                : "Off for this workspace."
          }
          right={
            push.permission === "denied" ? null : (
              <Switch
                accessibilityLabel="Alerts on this phone"
                value={push.permission === "granted" && push.settings.enabled}
                onValueChange={(on) => void push.setEnabled(on)}
              />
            )
          }
        />
        {push.permission === "denied" ? (
          <Row title="Open the phone's settings" onPress={openAppSettings} right={<ExternalLink size={18} color={theme.inkMuted} />} />
        ) : push.permission === "granted" && push.settings.enabled ? (
          <View style={styles.inset}>
            <Segmented
              accessibilityLabel="Which alerts"
              options={[
                { value: "critical", label: "Critical only" },
                { value: "warning", label: "Warnings and critical" },
              ]}
              value={push.settings.minSeverity}
              onChange={(v) => void push.setMinSeverity(v)}
            />
          </View>
        ) : null}
      </Lines>
      {push.error && <Text color="statusError">{push.error}</Text>}

      <Lines label="On the web">
        <Row
          title="Open IO Driven on the web"
          detail="Rules, templates, wiring, dashboard layouts, members and settings are edited there."
          onPress={() => void Linking.openURL(webUrl())}
          right={<ExternalLink size={18} color={theme.inkMuted} />}
        />
      </Lines>

      <Button variant="secondary" label="Sign out" onPress={confirmSignOut} />

      <Text size="micro" color="inkMuted" style={styles.version}>
        IO Driven {Constants.expoConfig?.version ?? ""} · {apiUrl().replace(/^https?:\/\//, "")}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 20 },
  version: { textAlign: "center" },
  inset: { paddingHorizontal: 14, paddingVertical: 10 },
});
