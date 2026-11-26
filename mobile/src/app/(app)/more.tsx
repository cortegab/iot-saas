import { ROLE_LABEL, toRole } from "@iodriven/shared/permissions";
import type { components } from "@iodriven/shared/api";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { Check, ExternalLink } from "lucide-react-native";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { useApiSWR } from "@/hooks/useApiSWR";
import { openAppSettings, usePush } from "@/push/PushProvider";
import { useInterfaceMode } from "@/hooks/useInterfaceMode";
import { apiUrl, webUrl } from "@/lib/config";
import { useTheme } from "@/theme/useTheme";
import { Button } from "@/ui/Button";
import { Lines, Row } from "@/ui/Row";
import { Segmented } from "@/ui/Segmented";
import { Switch } from "@/ui/Switch";
import { Text } from "@/ui/Text";
import { useT } from "@/i18n/I18nProvider";
import { useLanguage } from "@/hooks/useLanguage";
import { LOCALES, LOCALE_NAMES, isLocale } from "@iodriven/shared/i18n";

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
  const view = useInterfaceMode();
  const t = useT();
  const language = useLanguage();

  function confirmSignOut() {
    Alert.alert(t("app.more.signOutTitle"), t("app.more.signOutBody"), [
      { text: t("common.cancel"), style: "cancel" },
      // The phone stops receiving this account's alerts before the session ends.
      { text: t("common.signOut"), style: "destructive", onPress: () => void push.unregisterAll().finally(() => void logout()) },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Lines label={t("app.more.account")}>
        <Row title={me?.name || me?.email || "…"} detail={me?.name ? me.email : undefined} />
      </Lines>

      <Lines label={t("app.more.workspace")}>
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

      {/* DESIGN.md §15a: the same choice as the web's account menu, for this workspace. */}
      <Lines label={t("app.more.view")}>
        <Row
          title={t("shell.simpleView")}
          detail={t("app.more.simpleDetail")}
          right={<Switch value={view.simple} onValueChange={(v) => void view.setSimple(v)} accessibilityLabel={t("shell.simpleView")} />}
        />
      </Lines>

      {/* DESIGN.md §11a: the same choice as the web's account menu, saved on the account. */}
      <Lines label={t("app.more.language")}>
        <View style={styles.inset}>
          <Segmented
            accessibilityLabel={t("app.more.language")}
            options={[
              { value: "phone", label: t("language.phone") },
              ...LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] })),
            ]}
            value={language.choice ?? "phone"}
            onChange={(v) => void language.setChoice(isLocale(v) ? v : null)}
          />
        </View>
      </Lines>

      <Lines label={t("app.more.notifications")}>
        <Row
          title={t("app.more.alertsOnPhone")}
          detail={
            push.permission === "denied"
              ? t("app.more.pushDenied")
              : push.settings.enabled && push.permission === "granted"
                ? t("app.more.pushOn")
                : t("app.more.pushOff")
          }
          right={
            push.permission === "denied" ? null : (
              <Switch
                accessibilityLabel={t("app.more.alertsOnPhone")}
                value={push.permission === "granted" && push.settings.enabled}
                onValueChange={(on) => void push.setEnabled(on)}
              />
            )
          }
        />
        {push.permission === "denied" ? (
          <Row title={t("app.more.openSettings")} onPress={openAppSettings} right={<ExternalLink size={18} color={theme.inkMuted} />} />
        ) : push.permission === "granted" && push.settings.enabled ? (
          <View style={styles.inset}>
            <Segmented
              accessibilityLabel={t("app.more.whichAlerts")}
              options={[
                { value: "critical", label: t("app.more.criticalOnly") },
                { value: "warning", label: t("app.more.warnings") },
              ]}
              value={push.settings.minSeverity}
              onChange={(v) => void push.setMinSeverity(v)}
            />
          </View>
        ) : null}
      </Lines>
      {push.error && <Text color="statusError">{push.error}</Text>}

      <Lines label={t("app.more.onWeb")}>
        <Row
          title={t("app.more.openWeb")}
          detail={t("app.more.webDetail")}
          onPress={() => void Linking.openURL(webUrl())}
          right={<ExternalLink size={18} color={theme.inkMuted} />}
        />
      </Lines>

      <Button variant="secondary" label={t("common.signOut")} onPress={confirmSignOut} />

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
