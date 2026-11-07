import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { radius } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Text } from "./Text";

/** DESIGN.md §4 / §15 sheet: one item's detail from the bottom of the
 * screen, its actions at the foot. Tapping outside or Back closes it. */
export function Sheet({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.grip, { backgroundColor: theme.border }]} />
          <View style={styles.head}>
            <Text size="section" weight="semibold" accessibilityRole="header">
              {title}
            </Text>
            {sub ? (
              <Text size="meta" color="inkMuted">
                {sub}
              </Text>
            ) : null}
          </View>
          <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>
          {footer ? <View style={[styles.footer, { borderTopColor: theme.borderSoft }]}>{footer}</View> : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { maxHeight: "85%", borderTopLeftRadius: radius["2xl"], borderTopRightRadius: radius["2xl"], borderWidth: StyleSheet.hairlineWidth },
  grip: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginTop: 8 },
  head: { paddingHorizontal: 16, paddingTop: 12, gap: 2 },
  body: { padding: 16, gap: 12 },
  footer: { padding: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
