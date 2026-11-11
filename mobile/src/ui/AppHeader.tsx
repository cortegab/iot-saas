import { ROLE_LABEL, toRole } from "@iodriven/shared/permissions";
import { useRouter } from "expo-router";
import { Check, ChevronDown, ScanQrCode } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthProvider";
import { touchTarget } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Row } from "./Row";
import { Sheet } from "./Sheet";
import { Text } from "./Text";

const roleLabel = (role: string) => {
  const r = toRole(role);
  return r ? ROLE_LABEL[r] : role;
};

/** The web's phone top bar (DESIGN.md §4, §15): the IO Driven mark, then
 * IO Driven over the workspace's name, which opens the workspace switcher,
 * and Scan at the right, where the web has search.
 * It stays put above every screen; each screen's own header is below it. */
export function BrandBar() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { memberships, currentTenantId, setCurrentTenantId } = useAuth();
  const [open, setOpen] = useState(false);
  const name = memberships.find((m) => m.tenant_id === currentTenantId)?.tenant_name ?? "";

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 10, backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
      <Pressable accessibilityRole="link" accessibilityLabel="IO Driven, go to dashboards" onPress={() => router.navigate("/dashboards")} hitSlop={6}>
        <Image source={require("../../assets/mark.png")} style={styles.mark} accessibilityIgnoresInvertColors />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Workspace: ${name}. Switch workspace`}
        onPress={() => setOpen(true)}
        style={styles.lockup}
      >
        <Text weight="semibold">IO Driven</Text>
        <View style={styles.ws}>
          <Text size="meta" color="inkMuted" numberOfLines={1} style={styles.wsName}>
            {name}
          </Text>
          <ChevronDown size={14} color={theme.inkMuted} />
        </View>
      </Pressable>
      {/* Where the web has search: the app's scanner, from any screen. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scan a device's QR"
        onPress={() => router.navigate("/devices/scan")}
        style={styles.iconButton}
      >
        <ScanQrCode size={22} color={theme.inkMuted} />
      </Pressable>

      <Sheet open={open} onClose={() => setOpen(false)} title="Workspaces">
        {memberships.map((m) => {
          const current = m.tenant_id === currentTenantId;
          return (
            <Row
              key={m.tenant_id}
              title={m.tenant_name}
              detail={roleLabel(m.role)}
              selected={current}
              accessibilityLabel={`${m.tenant_name}, ${roleLabel(m.role)}`}
              onPress={() => {
                setOpen(false);
                if (!current) setCurrentTenantId(m.tenant_id);
              }}
              right={current ? <Check size={20} color={theme.accent} /> : null}
            />
          );
        })}
      </Sheet>
    </View>
  );
}

/** The parts of a screen's navigation options the page header reads. */
interface HeaderOptions {
  title?: string;
  headerTitle?: string | ((props: { children: string; tintColor?: string }) => ReactNode);
  headerRight?: (props: { tintColor?: string; canGoBack: boolean }) => ReactNode;
}

/** The web's page header (DESIGN.md §4), as each screen's header: the parent
 * as a link back (inner screens only), then the title row with the screen's
 * actions at its right. Screens keep setting `title`, `headerTitle` and
 * `headerRight` through `<Stack.Screen options>`. */
export function PageHeader({
  options,
  back,
  navigation,
}: {
  options: HeaderOptions;
  back?: { title?: string | undefined };
  navigation: { goBack: () => void };
}) {
  const theme = useTheme();
  const title = options.title ?? "";
  const custom = typeof options.headerTitle === "function" ? options.headerTitle({ children: title, tintColor: theme.ink }) : null;
  return (
    <View style={[styles.page, { backgroundColor: theme.canvas }]}>
      {back?.title ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Back to ${back.title}`}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 8, left: 8, right: 16 }}
          style={styles.crumb}
        >
          <Text size="meta" color="inkMuted">
            {back.title}
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.titleRow}>
        <View style={styles.titleCell}>
          {custom ?? (
            <Text size="title" weight="semibold" accessibilityRole="header" numberOfLines={2} style={styles.title}>
              {typeof options.headerTitle === "string" ? options.headerTitle : title}
            </Text>
          )}
        </View>
        {options.headerRight?.({ tintColor: theme.ink, canGoBack: !!back })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 10, paddingLeft: 16, paddingRight: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  iconButton: { width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  mark: { width: 32, height: 32, borderRadius: 9 },
  lockup: { flex: 1, minWidth: 0, minHeight: 40, justifyContent: "center" },
  ws: { flexDirection: "row", alignItems: "center", gap: 2, minWidth: 0 },
  wsName: { flexShrink: 1 },
  page: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 2 },
  crumb: { alignSelf: "flex-start" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 40 },
  titleCell: { flex: 1, minWidth: 0 },
  title: { letterSpacing: -0.4 },
});
