import { timeAgo } from "@iodriven/shared/time-ago";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { apiUrl } from "@/lib/config";
import { font, radius, text, touchTarget } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

type Check = { state: "checking" } | { state: "ok"; at: string } | { state: "failed"; at: string; reason: string };

async function checkApi(url: string): Promise<Check> {
  const at = new Date().toISOString();
  try {
    const res = await fetch(`${url}/health`);
    const body = (await res.json()) as { status?: string };
    return res.ok && body.status === "ok" ? { state: "ok", at } : { state: "failed", at, reason: `It answered ${res.status}.` };
  } catch {
    return { state: "failed", at, reason: "No answer. Is the phone online, and on USB is the port forwarded (adb reverse tcp:8000 tcp:8000)?" };
  }
}

/** Phase 0: proves the build reaches the API it was made for. Sign-in and
 * the app's tabs replace this screen in Phase 1. */
export default function Home() {
  const theme = useTheme();
  const [check, setCheck] = useState<Check>({ state: "checking" });
  const [, tick] = useState(0);
  let url = "";
  let configError: string | null = null;
  try {
    url = apiUrl();
  } catch (e) {
    configError = (e as Error).message;
  }

  // Each attempt (mount, then every "Check again") asks /health once; the
  // result lands in a callback, never synchronously in the effect.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!url) return;
    let live = true;
    void checkApi(url).then((result) => {
      if (live) setCheck(result);
    });
    return () => {
      live = false;
    };
  }, [url, attempt]);

  // Keeps "checked … ago" current.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const status =
    configError ??
    (check.state === "checking"
      ? "Checking…"
      : check.state === "ok"
        ? `Reachable · checked ${timeAgo(check.at)}`
        : `${check.reason} Checked ${timeAgo(check.at)}.`);
  const tone = configError || check.state === "failed" ? theme.statusError : check.state === "ok" ? theme.statusOnline : theme.inkMuted;

  return (
    <View style={[styles.page, { backgroundColor: theme.canvas }]}>
      <Stack.Screen options={{ title: "iodriven" }} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.label, { color: theme.inkMuted }]}>API</Text>
        <Text style={[styles.body, { color: theme.ink }]} selectable>
          {url || "Not set"}
        </Text>
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: tone }]}>
          {status}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={!url || check.state === "checking"}
          onPress={() => {
            setCheck({ state: "checking" });
            setAttempt((n) => n + 1);
          }}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.surfaceRaised, borderColor: theme.border, opacity: pressed || check.state === "checking" ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.buttonText, { color: theme.ink }]}>Check again</Text>
        </Pressable>
      </View>
      <Text style={[styles.meta, { color: theme.inkMuted }]}>Sign-in, devices and dashboards arrive in the next build.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16, gap: 12 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: 16, gap: 8 },
  label: { fontFamily: font.medium, ...text.micro },
  body: { fontFamily: font.regular, ...text.sm },
  meta: { fontFamily: font.regular, ...text.meta },
  button: {
    alignSelf: "flex-start",
    minHeight: touchTarget,
    paddingHorizontal: 14,
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonText: { fontFamily: font.medium, ...text.sm },
});
