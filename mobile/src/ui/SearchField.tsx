import { Search, X } from "lucide-react-native";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { font, radius, text, touchTarget } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

/** A list's search box: magnifier, the query, and Clear once there's text. */
export function SearchField({ value, onChangeText, label }: { value: string; onChangeText: (v: string) => void; label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: theme.input, borderColor: theme.border }]}>
      <Search size={18} color={theme.inkMuted} />
      <TextInput
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={theme.inkMuted}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={[styles.input, { color: theme.ink, fontFamily: font.regular }]}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => onChangeText("")}>
          <X size={18} color={theme.inkMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { minHeight: touchTarget, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, paddingVertical: 8, ...text.sm },
});
