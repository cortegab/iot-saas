import { Eye, EyeOff } from "lucide-react-native";
import { forwardRef, useState, type ComponentRef } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { font, radius, text, touchTarget } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import { Text } from "./Text";

/** DESIGN.md §5 Field: label above, the control, then a hint or the error. A
 * `password` field has Show / Hide, like the web's PasswordInput. */
export type TextInputRef = ComponentRef<typeof TextInput>;

export const TextField = forwardRef<TextInputRef, TextInputProps & { label: string; error?: string | null; hint?: string; password?: boolean }>(
  function TextField({ label, error, hint, password = false, style, ...props }, ref) {
    const theme = useTheme();
    const [shown, setShown] = useState(false);
    return (
      <View style={styles.field}>
        <Text size="meta" weight="medium" color="inkMuted">
          {label}
        </Text>
        <View
          style={[
            styles.control,
            { backgroundColor: theme.input, borderColor: error ? theme.statusError : theme.border },
          ]}
        >
          <TextInput
            ref={ref}
            accessibilityLabel={label}
            placeholderTextColor={theme.inkMuted}
            secureTextEntry={password && !shown}
            autoCapitalize={password ? "none" : props.autoCapitalize}
            style={[styles.input, { color: theme.ink, fontFamily: font.regular }, style]}
            {...props}
          />
          {password && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={shown ? "Hide password" : "Show password"}
              hitSlop={8}
              onPress={() => setShown((s) => !s)}
              style={styles.eye}
            >
              {shown ? <EyeOff size={20} color={theme.inkMuted} /> : <Eye size={20} color={theme.inkMuted} />}
            </Pressable>
          )}
        </View>
        {(error || hint) && (
          <Text size="meta" color={error ? "statusError" : "inkMuted"} accessibilityLiveRegion="polite">
            {error ?? hint}
          </Text>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  field: { gap: 6 },
  control: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
  },
  input: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, ...text.sm },
  eye: { paddingHorizontal: 12, minHeight: touchTarget, justifyContent: "center" },
});
