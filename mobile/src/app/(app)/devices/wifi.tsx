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
  networksFrom,
  signalLabel,
  type Step,
  type WifiNetwork,
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
  | { kind: "working"; step: Step; label: string }
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

  const [phase, setPhase] = useState<Phase>({ kind: "working", step: "permission", label: "Checking Bluetooth access…" });
  const board = useRef<ESPDevice | null>(null);
  const started = useRef(false);

  useEffect(
    () => () => {
      board.current?.disconnect();
      scannedQr.clear();
    },
    [],
  );

  const fail = (step: Step, error: unknown, retry: () => void) => setPhase({ kind: "failed", step, ...explainFailure(step, error), retry });

  async function scanNetworks() {
    const b = board.current;
    if (!b) return;
    setPhase({ kind: "working", step: "scan", label: "Asking the board for nearby Wi-Fi…" });
    try {
      setPhase({ kind: "networks", networks: networksFrom(await b.scanWifiList()) });
    } catch (e) {
      fail("scan", e, () => void scanNetworks());
    }
  }

  async function connect() {
    if (!qr) return;
    setPhase({ kind: "working", step: "permission", label: "Checking Bluetooth access…" });
    if (!(await requestBlePermissions())) {
      fail("permission", new Error("permission"), () => void connect());
      return;
    }
    setPhase({ kind: "working", step: "connect", label: `Looking for ${qr.name} over Bluetooth…` });
    try {
      board.current?.disconnect();
      board.current = await connectBoard(qr);
    } catch (e) {
      fail("connect", e, () => void connect());
      return;
    }
    await scanNetworks();
  }

  async function send(ssid: string, password: string, networks: WifiNetwork[]) {
    const b = board.current;
    if (!b) return;
    setPhase({ kind: "working", step: "provision", label: `Sending ${ssid} to the board…` });
    try {
      await b.provision(ssid, password);
      setPhase({ kind: "joined", ssid, at: Date.now() });
    } catch (e) {
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

        {!needsPick && phase.kind === "working" && <Working label={phase.label} />}

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

        {phase.kind === "joined" && <Joined ssid={phase.ssid} since={phase.at} device={device} onDone={() => router.back()} />}

        {phase.kind === "failed" && (
          <View style={styles.block}>
            <Text weight="semibold" color="statusError">
              {phase.title}
            </Text>
            <Text color="inkMuted">{phase.detail}</Text>
            <Button label="Try again" onPress={phase.retry} />
            <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Working({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.working} accessibilityLiveRegion="polite">
      <ActivityIndicator color={theme.accent} />
      <Text color="inkMuted">{label}</Text>
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
function Joined({ ssid, since, device, onDone }: { ssid: string; since: number; device: DeviceResponse | null; onDone: () => void }) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  const { data } = useApiSWR<DeviceResponse>(device ? `/devices/${device.id}` : null, { refreshInterval: 2_000 });
  const online = data != null && data.last_seen_at != null && new Date(data.last_seen_at).getTime() >= since - 5_000;

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), ONLINE_WAIT_MS);
    return () => clearTimeout(id);
  }, []);

  if (!device) {
    return (
      <View style={styles.block}>
        <Text weight="semibold">The board joined {ssid}.</Text>
        <Text color="inkMuted">It connects to IO Driven next. Its device page shows when it&apos;s online.</Text>
        <Button label="Done" onPress={onDone} />
      </View>
    );
  }

  const open = () => router.replace({ pathname: "/devices/[deviceId]", params: { deviceId: device.id } });
  if (online) {
    return (
      <View style={styles.block}>
        <Text weight="semibold" color="statusOnline">
          {device.name} is online
        </Text>
        <Text color="inkMuted">It joined {ssid} and sent its first message.</Text>
        <Button label="Open device" onPress={open} />
      </View>
    );
  }
  return (
    <View style={styles.block}>
      <Text weight="semibold">The board joined {ssid}.</Text>
      {timedOut ? (
        <>
          <Text color="inkMuted">
            It hasn&apos;t reached IO Driven yet. Check that this Wi-Fi has internet access, then restart the board. The device page turns online as soon as it
            connects.
          </Text>
          <Button label="Open device" onPress={open} />
        </>
      ) : (
        <>
          <Working label={`Waiting for ${device.name} to come online. This usually takes under a minute.`} />
          <Button label="Open device" variant="secondary" onPress={open} />
        </>
      )}
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
