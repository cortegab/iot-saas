import { Redirect, useLocalSearchParams, type Href } from "expo-router";
import * as Linking from "expo-linking";
import { useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthProvider";
import { safeNext, signInError } from "@/auth/session";
import { webUrl } from "@/lib/config";
import { useTheme } from "@/theme/useTheme";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { TextField, type TextInputRef } from "@/ui/TextField";

/** Sign in with the same account as the web. New accounts and password
 * resets happen on the web (DESIGN.md §15). */
export default function SignIn() {
  const theme = useTheme();
  const { status, login } = useAuth();
  // Where a label link (or any deep link) was going before sign-in.
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInputRef>(null);

  if (status === "authenticated") return <Redirect href={(safeNext(next) ?? "/dashboards") as Href} />;

  async function submit() {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(signInError(err));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.canvas }]}>
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={styles.head}>
            <View style={styles.brand}>
              <Image source={require("../../assets/mark.png")} style={styles.mark} accessibilityIgnoresInvertColors />
              <Text size="section" weight="semibold">
                IO Driven
              </Text>
            </View>
            <Text size="title" weight="semibold" accessibilityRole="header">
              Sign in
            </Text>
            <Text color="inkMuted">Use your IO Driven account.</Text>
          </View>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <TextField
              ref={passwordRef}
              label="Password"
              password
              value={password}
              onChangeText={setPassword}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
            {error && (
              <Text color="statusError" accessibilityLiveRegion="assertive">
                {error}
              </Text>
            )}
            <Button label={busy ? "Signing in…" : "Sign in"} busy={busy} onPress={() => void submit()} />
          </View>
          <View style={styles.links}>
            <Button variant="secondary" label="Forgot password?" onPress={() => void Linking.openURL(`${webUrl()}/forgot-password`)} />
            <Text size="meta" color="inkMuted">
              No account yet? Create one at {webUrl().replace(/^https?:\/\//, "")}.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  mark: { width: 40, height: 40 },
  safe: { flex: 1 },
  page: { padding: 16, gap: 20, flexGrow: 1, justifyContent: "center" },
  head: { gap: 6 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 16, gap: 16 },
  links: { gap: 12, alignItems: "flex-start" },
});
