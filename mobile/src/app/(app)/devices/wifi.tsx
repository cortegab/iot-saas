import type { components } from "@iodriven/shared/api";
import type { ProvisioningQr } from "@iodriven/shared/provisioning-qr";
import type { ESPDevice } from "@orbital-systems/react-native-esp-idf-provisioning";
import { Stack, useRouter } from "expo-router";
import { Lock } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useApiSWR } from "@/hooks/useApiSWR";
import {
  explainFailure,
  logStep,
  networksFrom,
  signalLabel,
  STEP_LIMIT_MS,
  type Step,
  type WifiNetwork,
  withTimeout,
} from "@/provisioning/wifi";
import { connectBoard, requestBlePermissions } from "@/provisioning/ble";
import { devicesForQr, scannedQr } from "@/provisioning/scanned";
import { useTheme } from "@/theme/useTheme";
import { Button } from "@/ui/Button";
import { Lines, Row } from "@/ui/Row";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

type DeviceResponse = components["schemas"]["DeviceResponse"];

type Phase =
  | { kind: "working"; step: Step; label: string; at: number }
  | { kind: "networks"; networks: WifiNetwork[] }
  | { kind: "password"; ssid: string; open: boolean; networks: WifiNetwork[] }
  | { kind: "joined"; ssid: string; at: number }
  | { kind: "failed"; step: Step; title: string; detail: string; retry: () => void };

/** How long to wait for a board's first message after it joined Wi-Fi. */
const ONLINE_WAIT_MS = 90_000;

/** Set up a board's Wi-Fi from its provisioning QR (docs/ble-provisioning.md;
 * the ESP BLE Provisioning app's job, in IO Driven): find the board over
 * Bluetooth, open a secure session with the QR's code, pick a network, send
 * its password, then wait for the device's first message, like the web's
 * live check. */
export default function WifiSetup() {
  const router = useRouter();
  // The QR is read once: it stays in memory only for this screen.
  const [qr] = useState<ProvisioningQr | null>(() => scannedQr.get());
  const { data: devices } = useApiSWR<DeviceResponse[]>("/devices");
  const matches = qr && devices ? devicesForQr(devices, qr) : [];
  const [chosen, setChosen] = useState<string | null>(null);
  const deviceId = chosen ?? (matches.length === 1 ? matches[0].id : null);
  const device = matches.find((d) => d.id === deviceId) ?? null;

  const [phase, setPhase] = useState<Phase>({ kind: "working", step: "permission", label: "Checking Bluetooth access…", at: Date.now() });
  const board = useRef<ESPDevice | null>(null);
  const started = useRef(false);
  // Each step takes a number; a step that answers after it was given up on
  // (timed out, cancelled, retried) no longer changes the screen.
  const run = useRef(0);
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
      board.current?.disconnect();
      scannedQr.clear();
    },
    [],
  );

  const working = (step: Step, label: string) => {
    logStep(step, "start");
    setPhase({ kind: "working", step, label, at: Date.now() });
    return ++run.current;
  };
  const current = (n: number) => alive.current && n === run.current;
  const fail = (step: Step, error: unknown, retry: () => void) => {
    logStep(step, `failed: ${error instanceof Error ? error.message : String(error)}`);
    setPhase({ kind: "failed", step, ...explainFailure(step, error), retry });
  };

  // Back to the device list; the board's Bluetooth session closes as the
  // screen leaves.
  const cancel = () => {
    logStep("cancel", phase.kind === "working" ? phase.step : phase.kind);
    run.current++;
    router.navigate("/devices");
  };

  async function scanNetworks() {
    const b = board.current;
    if (!b) return;
    const n = working("scan", "Asking the board for nearby Wi-Fi…");
    try {
      const list = await withTimeout(b.scanWifiList(), STEP_LIMIT_MS.scan, "scan");
      if (!current(n)) return;
      logStep("scan", `${list.length} networks`);
      setPhase({ kind: "networks", networks: networksFrom(list) });
    } catch (e) {
      if (current(n)) fail("scan", e, () => void scanNetworks());
    }
  }

  async function connect() {
    if (!qr) return;
    let n = working("permission", "Checking Bluetooth access…");
    if (!(await requestBlePermissions())) {
      if (current(n)) fail("permission", new Error("permission"), () => void connect());
      return;
    }
    if (!current(n)) return;
    n = working("connect", `Looking for ${qr.name} over Bluetooth…`);
    try {
      board.current?.disconnect();
      const b = await withTimeout(connectBoard(qr), STEP_LIMIT_MS.connect, "connect");
      if (!current(n)) {
        b.disconnect();
        return;
      }
      board.current = b;
      logStep("connect", "connected");
    } catch (e) {
      if (current(n)) fail("connect", e, () => void connect());
      return;
    }
    await scanNetworks();
  }

  async function send(ssid: string, password: string, networks: WifiNetwork[]) {
    const b = board.current;
    if (!b) return;
    const n = working("provision", `Sending ${ssid} to the board…`);
    try {
      await withTimeout(b.provision(ssid, password), STEP_LIMIT_MS.provision, "provision");
      if (!current(n)) return;
      logStep("joined", "the board took the Wi-Fi");
      setPhase({ kind: "joined", ssid, at: Date.now() });
    } catch (e) {
      if (!current(n)) return;
      logStep("provision", `failed: ${e instanceof Error ? e.message : String(e)}`);
      // A wrong password or missing network: back to the form, not the start.
      setPhase({
        kind: "failed",
        step: "provision",
        ...explainFailure("provision", e),
        retry: () => setPhase({ kind: "password", ssid, open: password === "", networks }),
      });
    }
  }

  // Start once the device list says which device this is (or that it's
  // ambiguous: then the person picks first).
  const needsPick = matches.length > 1 && !chosen;
  useEffect(() => {
    if (!qr || !devices || started.current || needsPick) return;
    started.current = true;
    void connect();
    // connect() reads the latest state; run it once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr, devices, needsPick]);

  const title = <Stack.Screen options={{ title: "Set up Wi-Fi" }} />;

  if (!qr) {
    return (
      <View style={styles.page}>
        {title}
        <Text color="inkMuted">Scan the board&apos;s Wi-Fi setup QR first.</Text>
        <Button label="Scan a QR" onPress={() => router.replace("/devices/scan")} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {title}
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <Text size="section" weight="semibold">
            {device?.name ?? qr.name}
          </Text>
          <Text size="meta" color="inkMuted">
            {device
              ? `Board ${qr.name} · Security ${qr.security}`
              : devices && matches.length === 0
                ? `No device in this workspace is named ${qr.name}. You can still set up its Wi-Fi.`
                : `Board ${qr.name}`}
          </Text>
        </View>

        {needsPick && (
          <Lines label="Which device is this board?">
            {matches.map((d) => (
              <Row
                key={d.id}
                title={d.name}
                detail={d.last_seen_at ? "Has connected before" : "Never connected"}
                onPress={() => setChosen(d.id)}
              />
            ))}
          </Lines>
        )}

        {!needsPick && phase.kind === "working" && (
          <View style={styles.block}>
            <Working key={phase.at} label={phase.label} />
            <Button label="Cancel" variant="secondary" onPress={cancel} />
          </View>
        )}

        {phase.kind === "networks" && (
          <Networks
            networks={phase.networks}
            onPick={(n) => setPhase({ kind: "password", ssid: n.ssid, open: n.open, networks: phase.networks })}
            onOther={() => setPhase({ kind: "password", ssid: "", open: false, networks: phase.networks })}
            onRescan={() => void scanNetworks()}
          />
        )}

        {phase.kind === "password" && (
          <PasswordForm
            key={phase.ssid}
            ssid={phase.ssid}
            open={phase.open}
            onSend={(ssid, password) => void send(ssid, password, phase.networks)}
            onBack={() => setPhase({ kind: "networks", networks: phase.networks })}
          />
        )}

        {phase.kind === "joined" && <Joined ssid={phase.ssid} board={qr.name} since={phase.at} device={device} onDevices={() => router.navigate("/devices")} />}

        {phase.kind === "failed" && (
          <View style={styles.block}>
            <Text weight="semibold" color="statusError">
              {phase.title}
            </Text>
            <Text color="inkMuted">{phase.detail}</Text>
            <Button label="Try again" onPress={phase.retry} />
            <Button label="Cancel" variant="secondary" onPress={cancel} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** A spinner line; after a few seconds it also counts the wait, so a slow
 * board doesn't look frozen. */
function Working({ label }: { label: string }) {
  const theme = useTheme();
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.floor((now - start) / 1_000);
  return (
    <View style={styles.working} accessibilityLiveRegion="polite">
      <ActivityIndicator color={theme.accent} />
      <Text color="inkMuted" style={styles.flex}>
        {label}
        {seconds >= 5 ? ` ${seconds} s` : ""}
      </Text>
    </View>
  );
}

function Networks({
  networks,
  onPick,
  onOther,
  onRescan,
}: {
  networks: WifiNetwork[];
  onPick: (n: WifiNetwork) => void;
  onOther: () => void;
  onRescan: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.block}>
      <Lines label="Wi-Fi the board can see">
        {[
          ...networks.map((n) => (
            <Row
              key={n.ssid}
              title={n.ssid}
              detail={`${signalLabel(n.rssi)} signal · ${n.open ? "Open" : "Secured"}`}
              right={n.open ? null : <Lock size={16} color={theme.inkMuted} />}
              onPress={() => onPick(n)}
              accessibilityLabel={`${n.ssid}, ${signalLabel(n.rssi)} signal, ${n.open ? "open" : "secured"}`}
            />
          )),
          <Row key="other" title="Other network" detail="Type its name (hidden networks)" onPress={onOther} />,
        ]}
      </Lines>
      {networks.length === 0 && <Text color="inkMuted">The board sees no 2.4 GHz networks. Move it closer to the router and scan again.</Text>}
      <Button label="Scan again" variant="secondary" onPress={onRescan} />
    </View>
  );
}

function PasswordForm({
  ssid: initial,
  open,
  onSend,
  onBack,
}: {
  ssid: string;
  open: boolean;
  onSend: (ssid: string, password: string) => void;
  onBack: () => void;
}) {
  const [ssid, setSsid] = useState(initial);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!ssid.trim()) return setError("Enter the network's name.");
    if (!open && password.length > 0 && password.length < 8) return setError("Wi-Fi passwords are at least 8 characters.");
    onSend(ssid.trim(), open ? "" : password);
  }

  return (
    <View style={styles.block}>
      {initial ? (
        <Text weight="medium">{initial}</Text>
      ) : (
        <TextField label="Network name" value={ssid} onChangeText={setSsid} autoCapitalize="none" autoCorrect={false} />
      )}
      {!open && (
        <TextField
          label="Wi-Fi password"
          password
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            setError(null);
          }}
          error={error}
          hint="Sent to the board only, over the secure Bluetooth session."
          returnKeyType="go"
          onSubmitEditing={submit}
          autoFocus
        />
      )}
      {open && error && <Text color="statusError">{error}</Text>}
      <Button label="Join" onPress={submit} />
      <Button label="Choose another network" variant="secondary" onPress={onBack} />
    </View>
  );
}

/** After the board took the Wi-Fi: wait for the device's first message (the
 * web's live check), then offer the device. */
function Joined({
  ssid,
  board,
  since,
  device,
  onDevices,
}: {
  ssid: string;
  board: string;
  since: number;
  device: DeviceResponse | null;
  onDevices: () => void;
}) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  const { data } = useApiSWR<DeviceResponse>(device ? `/devices/${device.id}` : null, { refreshInterval: 2_000 });
  const online = data != null && data.last_seen_at != null && new Date(data.last_seen_at).getTime() >= since - 5_000;
  const name = device?.name ?? board;

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), ONLINE_WAIT_MS);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (online) logStep("joined", "online");
  }, [online]);

  // The Bluetooth part is over: say so first, so a slow connection to IO
  // Driven isn't mistaken for a stuck setup.
  const took = (
    <Text weight="semibold" color={online ? "statusOnline" : "ink"}>
      {online ? `${name} is online` : `${name} has the Wi-Fi`}
    </Text>
  );
  const devices = <Button label="Back to devices" variant="secondary" onPress={onDevices} />;

  if (!device) {
    return (
      <View style={styles.block}>
        {took}
        <Text color="inkMuted">It joins {ssid} and connects to IO Driven next. Its device page shows when it&apos;s online.</Text>
        <Button label="Back to devices" onPress={onDevices} />
      </View>
    );
  }

  const open = () => router.replace({ pathname: "/devices/[deviceId]", params: { deviceId: device.id } });
  if (online) {
    return (
      <View style={styles.block}>
        {took}
        <Text color="inkMuted">It joined {ssid} and sent its first message.</Text>
        <Button label="Open device" onPress={open} />
        {devices}
      </View>
    );
  }
  return (
    <View style={styles.block}>
      {took}
      {timedOut ? (
        <>
          <Text color="inkMuted">
            It hasn&apos;t reached IO Driven yet. Check that {ssid} has internet access, then restart the board. The device page turns online as soon as it
            connects.
          </Text>
          <Button label="Open device" onPress={open} />
        </>
      ) : (
        <>
          <Text color="inkMuted">The phone is done. You can leave this screen: the device page turns online by itself.</Text>
          <Working label={`Waiting for ${device.name} to join ${ssid} and come online. This usually takes under a minute.`} />
          <Button label="Open device" variant="secondary" onPress={open} />
        </>
      )}
      {devices}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: 16, gap: 16 },
  head: { gap: 4 },
  block: { gap: 12 },
  working: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
});
