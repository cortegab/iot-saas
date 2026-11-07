import type { components } from "@iodriven/shared/api";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiUrl } from "@/lib/config";
import { compareVersions } from "@/lib/version";
import { useTheme } from "@/theme/useTheme";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

type ClientInfo = components["schemas"]["ClientInfoResponse"];

/** Blocks an app too old for the API (GET /meta/client, min_mobile_version):
 * mobile builds lag behind the server, so the API only ever changes
 * additively and raises the minimum when it can't. A failed check never
 * blocks: the app opens as usual. */
export function UpdateGate({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [info, setInfo] = useState<ClientInfo | null>(null);
  const current = Constants.expoConfig?.version ?? "0.0.0";

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch(`${apiUrl()}/meta/client`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<ClientInfo>) : null))
      .then(setInfo)
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, []);

  if (!info || compareVersions(current, info.min_mobile_version) >= 0) return <>{children}</>;
  return (
    <SafeAreaView style={[styles.page, { backgroundColor: theme.canvas }]}>
      <View style={styles.body}>
        <Text size="title" weight="semibold" accessibilityRole="header">
          Update required
        </Text>
        <Text color="inkMuted">
          This version of IO Driven ({current}) no longer works with the server. Install {info.latest_mobile_version || "the latest version"} to keep going.
        </Text>
        <Button label="Get the update" onPress={() => void Linking.openURL(info.mobile_update_url)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { flex: 1, padding: 24, gap: 16, justifyContent: "center" },
});
