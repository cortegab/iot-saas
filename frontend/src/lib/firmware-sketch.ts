/** Generates a ready-to-flash ESP32 Arduino sketch for a device, parameterized
 * by its catalog-declared metrics/actuators (CLAUDE.md §4's device contract):
 *
 * - telemetry on `{tenant}/{device}/{metric}`, published per the metric's
 *   publish profile (periodic / on_change / streaming). The catalog values at
 *   generation time are only defaults — the sketch follows the retained
 *   `{tenant}/{device}/config` topic live, so a catalog edit takes effect
 *   without a reflash;
 * - `cmd/{actuator}` commands (acked) plus the retained `state/{actuator}`
 *   desired state, so a reconnecting board converges;
 * - a retained `status` snapshot with an MQTT Last-Will of `online:false`,
 *   which is what the platform's online/offline state is driven by — the
 *   only liveness signal an actuator-only device has;
 * - Wi-Fi from a phone with Espressif provisioning — the ESP BLE Provisioning
 *   app scans the QR the dashboard shows (docs/ble-provisioning.md) — or typed
 *   into the sketch for a bench test. Only the chosen one is in the sketch.
 *
 * Both call sites pass the real credential: devices/new has it from creation,
 * and the device page's "Generate" rotates the credential first (it's stored
 * hashed — §9.12 — so there's no other way to embed it).
 */

import { wireId, type WireNamed } from "@/lib/wire-id";
import type { components } from "@/types/api";

type CatalogMetric = components["schemas"]["CatalogMetric"];
type CatalogActuator = components["schemas"]["CatalogActuator"];

const PLACEHOLDER_METRIC: SketchMetric = { name: "temperature", key: null };
const CREDENTIAL_PLACEHOLDER = "<paste your device credential here>";
const FW_VERSION = "1.0.0";

export type SketchBoard = "esp32" | "esp32c3";

/** What differs per board: the Arduino IDE settings, the BOOT button, the BLE
 * memory handler WiFiProv frees after provisioning, and the GPIOs handed out —
 * inputs and outputs from separate pools so a generated sketch never wires two
 * things to one pin. No strapping, flash or USB pins. */
export const BOARDS: Record<
  SketchBoard,
  { label: string; arduinoBoard: string; ideSettings: string[]; bootPin: number; bleHandler: string; inputs: number[]; outputs: number[] }
> = {
  esp32: {
    label: "ESP32 DevKit",
    arduinoBoard: "ESP32 Dev Module",
    ideSettings: [],
    bootPin: 0,
    bleHandler: "NETWORK_PROV_SCHEME_HANDLER_FREE_BTDM",
    inputs: [4, 5, 13, 14, 16, 17, 18, 19],
    outputs: [2, 23, 22, 21, 27, 26, 25, 33],
  },
  esp32c3: {
    label: "ESP32-C3",
    arduinoBoard: "ESP32C3 Dev Module",
    ideSettings: ["USB CDC On Boot: Enabled", "Flash Mode: DIO"],
    bootPin: 9,
    bleHandler: "NETWORK_PROV_SCHEME_HANDLER_FREE_BLE",
    // Strapping pins 2, 8, 9 and USB pins 18, 19 are left out; 20/21 (UART0)
    // are free with USB CDC on boot and go last.
    inputs: [4, 5, 6, 7, 10],
    outputs: [3, 1, 0, 20, 21],
  },
};

// Let's Encrypt's current root, fetched verbatim from
// https://letsencrypt.org/certs/isrgrootx1.pem (expires 2035-06-04). Prod's
// EMQX terminates TLS with a real Let's Encrypt cert (infra/PROD_DEPLOY.md
// §7), so a generated sketch can validate the chain for real instead of
// skipping verification with setInsecure().
const ISRG_ROOT_X1 = `-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----`;

export interface SketchCredential {
  username: string;
  password: string;
}

export type SketchMetric = WireNamed &
  Partial<Pick<CatalogMetric, "data_type" | "publish" | "publish_interval_seconds" | "publish_deadband">>;
export type SketchActuator = WireNamed & Partial<Pick<CatalogActuator, "value_type">>;

export interface SketchInfo {
  tenantSlug: string;
  deviceSlug: string;
  /** The device's name; also what the phone app lists while provisioning
   * (made BLE-safe by provName). */
  deviceName: string;
  /** The board the sketch targets. Default "esp32". */
  board?: SketchBoard;
  host: string;
  /** Whether the dashboard itself is being served over HTTPS. Prod's broker
   * is TLS-only on 8883 with a real Let's Encrypt cert; local dev is
   * plaintext on 1883 (infra/docker-compose.prod.yml vs infra/docker-compose.yml).
   * Drives whether the generated sketch uses WiFiClientSecure or WiFiClient. */
  tls: boolean;
  /** Declared metrics from the device's catalog entry. A device with neither
   * metrics nor actuators (a "Legacy" entry) gets one placeholder metric. */
  metrics: SketchMetric[];
  actuators: SketchActuator[];
  credential: SketchCredential | null;
  /** Wi-Fi typed into the sketch (a bench-test shortcut; readable from the
   * binary). Omitted → the board is provisioned from a phone. */
  wifi?: { ssid: string; password: string };
  /** Phone provisioning security (ignored with `wifi`). Default level 1.
   * Level 2 needs the SRP6a salt/verifier from lib/srp6a; without them the
   * sketch carries a placeholder and isn't ready to flash. */
  provisioning?: { security: 1 } | { security: 2; salt?: Uint8Array; verifier?: Uint8Array };
  /** GPIO overrides keyed "m:<metric id>" (bool inputs) / "a:<actuator id>"
   * (outputs); anything not given uses defaultPins(). */
  pins?: Record<string, number>;
}

/** Every GPIO the pickers offer for a board — its input and output pools. */
export function pinChoices(board: SketchBoard = "esp32"): number[] {
  const b = BOARDS[board];
  return [...new Set([...b.inputs, ...b.outputs])].sort((x, y) => x - y);
}

/** Pins handed out in order: bool metrics from the input pool, non-string
 * actuators from the output pool, so the defaults never clash. */
export function defaultPins(metrics: SketchMetric[], actuators: SketchActuator[], board: SketchBoard = "esp32"): Record<string, number> {
  const { inputs, outputs } = BOARDS[board];
  const out: Record<string, number> = {};
  let i = 0;
  let o = 0;
  for (const m of metrics) if (m.data_type === "bool") out[`m:${wireId(m)}`] = inputs[i++] ?? 0;
  for (const a of actuators) if ((a.value_type ?? "bool") !== "string") out[`a:${wireId(a)}`] = outputs[o++] ?? 0;
  return out;
}

/** The name the phone app lists: the device name in printable ASCII (accents
 * dropped), at most 29 bytes — the BLE limit. The sketch's PROV_NAME and the
 * QR's "name" both come from here, so they always match. */
export function provName(deviceName: string): string {
  const ascii = deviceName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (ascii || "iot-device").slice(0, 29).trim();
}

/** The QR payload the ESP BLE Provisioning app scans (docs/ble-provisioning.md).
 * `security` is always explicit: the app assumes 2 when it's missing. */
export function provisioningPayload(p: { name: string; username: string; password: string; security: 1 | 2 }): string {
  const body =
    p.security === 2
      ? { ver: "v1", name: p.name, username: p.username, pop: p.password, transport: "ble", network: "wifi", security: 2 }
      : { ver: "v1", name: p.name, pop: p.password, transport: "ble", network: "wifi", security: 1 };
  return JSON.stringify(body);
}

/** A byte array as a C initializer body, 16 per line. */
function cBytes(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => "0x" + b.toString(16).padStart(2, "0"));
  const lines: string[] = [];
  for (let i = 0; i < hex.length; i += 16) lines.push("  " + hex.slice(i, i + 16).join(", "));
  return lines.join(",\n");
}

/** Every GPIO an ESP32 DevKit picker offers (pinChoices("esp32")). */
export const PIN_CHOICES: readonly number[] = pinChoices("esp32");

/** Keys whose pin is shared with another key, with the reason to show. */
export function pinClashes(pins: Record<string, number>): Record<string, string> {
  const byPin = new Map<number, string[]>();
  for (const [key, pin] of Object.entries(pins)) byPin.set(pin, [...(byPin.get(pin) ?? []), key]);
  const out: Record<string, string> = {};
  for (const [pin, keys] of byPin) {
    if (keys.length < 2) continue;
    for (const k of keys) {
      const others = keys.filter((x) => x !== k).map((x) => x.slice(2));
      out[k] = `GPIO ${pin} is also used by ${others.join(", ")}.`;
    }
  }
  return out;
}

function toIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Safe inside a C string literal or a `//` comment. */
function cText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ");
}

const MODE_ENUM: Record<string, string> = {
  periodic: "MODE_PERIODIC",
  on_change: "MODE_ON_CHANGE",
  streaming: "MODE_STREAMING",
};

export function buildSketch(info: SketchInfo): string {
  const { tenantSlug, deviceSlug, host, tls, actuators } = info;
  const metrics =
    info.metrics.length > 0 ? info.metrics : actuators.length > 0 ? [] : [PLACEHOLDER_METRIC];
  const hasMetrics = metrics.length > 0;
  const subtree = `${tenantSlug}/${deviceSlug}`;
  const boardKey: SketchBoard = info.board ?? "esp32";
  const board = BOARDS[boardKey];
  const isC3 = boardKey === "esp32c3";
  // Phone provisioning unless Wi-Fi is typed into the sketch.
  const phone = !info.wifi;
  const prov = info.provisioning ?? { security: 1 as const };
  const bleName = cText(provName(info.deviceName || deviceSlug));

  const username = info.credential?.username ?? CREDENTIAL_PLACEHOLDER;
  const password = info.credential?.password ?? CREDENTIAL_PLACEHOLDER;

  const pins = { ...defaultPins(metrics, actuators, boardKey), ...(info.pins ?? {}) };

  const metricRows = metrics.map((m) => {
    const id = toIdentifier(wireId(m));
    const isBool = m.data_type === "bool";
    const pin = isBool ? (pins[`m:${wireId(m)}`] ?? 0) : null;
    return { m, id, isBool, pin, pinConst: `${id.toUpperCase()}_PIN` };
  });
  const actuatorRows = actuators.map((a) => {
    const id = toIdentifier(wireId(a));
    const type = a.value_type ?? "bool";
    const pin = type === "string" ? null : (pins[`a:${wireId(a)}`] ?? 0);
    return { a, id, type, pin, pinConst: `${id.toUpperCase()}_PIN` };
  });

  // ---- sections -----------------------------------------------------------

  const ideLines = [
    `Board: "${board.arduinoBoard}"`,
    ...board.ideSettings,
    ...(phone ? ['Partition Scheme: "Huge APP (3MB No OTA/1MB SPIFFS)" (BLE + Wi-Fi don\'t fit the default)'] : []),
  ];
  const header = `// Generated for device "${cText(info.deviceName || deviceSlug)}" (${subtree}), ${board.label}.
//
// Libraries (Arduino Library Manager): PubSubClient by Nick O'Leary, ArduinoJson
// by Benoit Blanchon. ESP32 board package by Espressif, version 3.x.
// Arduino IDE > Tools:
${ideLines.map((l) => `//   ${l}`).join("\n")}
//
${
  phone
    ? `// Wi-Fi: set it from a phone. On first boot the board advertises as
// "${bleName}"; scan the QR on the dashboard with the ESP BLE Provisioning app
// (Security ${prov.security}). The Wi-Fi is kept in flash. To set a new one, hold
// BOOT for 5 seconds while the board is running.`
    : `// Wi-Fi: typed into this sketch (bench test). It's readable from the binary.`
}`;

  const includes = `#include <WiFi.h>
${tls ? "#include <WiFiClientSecure.h>\n" : ""}${phone ? "#include <WiFiProv.h>\n" : ""}#include <PubSubClient.h>
#include <ArduinoJson.h>`;

  const settingsBlock = `const char* FW_VERSION = "${FW_VERSION}";
${
  tls
    ? `// MQTT broker — this dashboard's own host. The dashboard is served over HTTPS,
// so this targets the production TLS-only listener on 8883; the certificate
// chain is validated for real below (ROOT_CA), not skipped with setInsecure().`
    : `// MQTT broker — this dashboard's own host. Plaintext on 1883, matching this
// local/dev deployment (no TLS here).`
}
const char* MQTT_HOST = "${cText(host)}";
const int MQTT_PORT = ${tls ? 8883 : 1883};
// This device's credential. Regenerating the sketch from the dashboard rotates
// it, so the previous one stops working — reflash with the newest sketch.
const char* MQTT_USERNAME = "${cText(username)}";
const char* MQTT_PASSWORD = "${cText(password)}";

// Device contract topics (CLAUDE.md §4).
const char* TOPIC_STATUS = "${subtree}/status";
const char* TOPIC_CONFIG = "${subtree}/config";
${actuatorRows
  .map(
    ({ a, id }) => `const char* TOPIC_CMD_${id} = "${subtree}/cmd/${wireId(a)}";
const char* TOPIC_STATE_${id} = "${subtree}/state/${wireId(a)}";
const char* TOPIC_ACK_${id} = "${subtree}/ack/${wireId(a)}";`,
  )
  .join("\n")}

const unsigned long STATUS_INTERVAL_MS = 60000;
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 20000;`;

  const pinsBlock = [
    ...metricRows
      .filter((r) => r.isBool)
      .map((r) => `const int ${r.pinConst} = ${r.pin};  // input for "${cText(r.m.name)}"`),
    ...actuatorRows
      .filter((r) => r.pin !== null)
      .map((r) => `const int ${r.pinConst} = ${r.pin};  // output for "${cText(r.a.name)}"`),
  ].join("\n");

  const c3Power = isC3
    ? `
// ESP32-C3 boards (the Super Mini especially) fail to authenticate or run hot
// at full TX power; 8.5 dBm is plenty for a nearby access point.
const wifi_power_t TX_POWER = WIFI_POWER_8_5dBm;`
    : "";
  const c3PowerCase = isC3 ? `
    case ARDUINO_EVENT_WIFI_STA_START:
      WiFi.setTxPower(TX_POWER);
      break;` : "";

  const wifiBlock = phone
    ? `// ---- Wi-Fi from a phone: Espressif provisioning (docs/ble-provisioning.md) ----
// Keep the Bluetooth controller's RAM reserved, or BLE provisioning crashes at boot.
extern "C" bool btInUse() { return true; }

// The name the ESP BLE Provisioning app lists; the dashboard's QR carries it.
const char* PROV_NAME = "${bleName}";
${
  prov.security === 2
    ? `// Security 2 (SRP6a): the app proves it knows the device's password; the board
// keeps only this salt and verifier for it (username MQTT_USERNAME).
static const char SEC2_SALT[] = {
${prov.salt ? cBytes(prov.salt) : "  0x00 /* computed by the dashboard when you download the sketch */"}
};
static const char SEC2_VERIFIER[] = {
${prov.verifier ? cBytes(prov.verifier) : "  0x00 /* computed by the dashboard when you download the sketch */"}
};
static network_prov_security2_params_t SEC2_PARAMS = {SEC2_SALT, sizeof(SEC2_SALT), SEC2_VERIFIER, sizeof(SEC2_VERIFIER)};`
    : `// Security 1: the proof of possession is the device's password (MQTT_PASSWORD).`
}
const int BOOT_PIN = ${board.bootPin};
const unsigned long RESET_HOLD_MS = 5000;${c3Power}

void onWifiEvent(arduino_event_t* e) {
  switch (e->event_id) {
    case ARDUINO_EVENT_PROV_START:
      Serial.print("[PROV] no Wi-Fi stored, advertising over BLE as ");
      Serial.println(PROV_NAME);
      break;
    case ARDUINO_EVENT_PROV_CRED_RECV:
      Serial.println("[PROV] Wi-Fi received from the app");
      break;
    case ARDUINO_EVENT_PROV_CRED_FAIL:
      Serial.println("[PROV] couldn't join that network; check the password and send it again");
      break;
    case ARDUINO_EVENT_PROV_CRED_SUCCESS:
      Serial.println("[PROV] Wi-Fi saved");
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      Serial.print("[WIFI] connected, IP: ");
      Serial.println(WiFi.localIP());
      break;${c3PowerCase}
    default:
      break;
  }
}

// Connects with the Wi-Fi stored in flash, or starts BLE provisioning if there
// is none. Returns at once; loop() waits for the connection.
void provisioningBegin() {
  WiFi.onEvent(onWifiEvent);
  WiFiProv.beginProvision(NETWORK_PROV_SCHEME_BLE, ${board.bleHandler},
                          ${prov.security === 2 ? "NETWORK_PROV_SECURITY_2, (const char*)&SEC2_PARAMS" : "NETWORK_PROV_SECURITY_1, MQTT_PASSWORD"},
                          PROV_NAME, NULL, NULL, false);
}

// Hold BOOT for 5 seconds while running: forget the Wi-Fi and provision again.
// (Holding it while powering up would start the bootloader instead.)
unsigned long bootDownSince = 0;
void watchProvisioningReset() {
  if (digitalRead(BOOT_PIN) != LOW) {
    bootDownSince = 0;
    return;
  }
  if (bootDownSince == 0) bootDownSince = millis();
  if (millis() - bootDownSince >= RESET_HOLD_MS) {
    Serial.println("[PROV] BOOT held: forgetting Wi-Fi and restarting");
    WiFi.disconnect(false, true);  // erase the stored network only
    delay(100);
    ESP.restart();
  }
}

// MQTT waits here while the Wi-Fi is down; WiFiProv reconnects on its own.
void connectWifi() {
  while (WiFi.status() != WL_CONNECTED) {
    watchProvisioningReset();
    delay(250);
  }
}`
    : `// ---- Wi-Fi typed into the sketch (bench test) --------------------------------
const char* WIFI_SSID = "${cText(info.wifi?.ssid ?? "")}";
const char* WIFI_PASSWORD = "${cText(info.wifi?.password ?? "")}";${c3Power}
${isC3 ? `
void onWifiEvent(arduino_event_t* e) {
  if (e->event_id == ARDUINO_EVENT_WIFI_STA_START) WiFi.setTxPower(TX_POWER);
}
` : ""}
void connectWifi() {
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print("[WIFI] connecting to ");
    Serial.println(WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) delay(250);
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WIFI] failed, retrying");
      WiFi.disconnect(true);
    }
  }
  WiFi.setAutoReconnect(true);
  Serial.print("[WIFI] connected, IP: ");
  Serial.println(WiFi.localIP());
}`;

  const metricsBlock = hasMetrics
    ? `// ---- Telemetry -------------------------------------------------------------
// Each metric's publish profile. These defaults come from the device template;
// the platform's retained config message (applyConfig) overrides them live.
// Plain constants, not an enum: the Arduino IDE auto-generates function
// prototypes above the sketch, where a custom type isn't declared yet.
const uint8_t MODE_PERIODIC = 0;
const uint8_t MODE_ON_CHANGE = 1;
const uint8_t MODE_STREAMING = 2;

struct MetricProfile {
  const char* key;
  const char* topic;
  bool isBool;
  uint8_t mode;
  unsigned long intervalMs;  // periodic: every; on_change: heartbeat; streaming: min gap
  float deadband;            // on_change, numeric: ignore changes up to this size
  float lastValue;           // NAN = nothing sent yet
  unsigned long lastPublishMs;
  float candidate;           // bool debounce
  unsigned long candidateSinceMs;
};

const unsigned long BOOL_DEBOUNCE_MS = 30;
const unsigned long ON_CHANGE_MIN_GAP_MS = 100;

unsigned long defaultIntervalMs(uint8_t mode) {
  if (mode == MODE_ON_CHANGE) return 300000UL;  // heartbeat
  if (mode == MODE_STREAMING) return 1000UL;
  return 15000UL;
}

MetricProfile metrics[] = {
${metricRows
  .map(({ m, isBool }) => {
    const mode = MODE_ENUM[m.publish ?? "periodic"] ?? "MODE_PERIODIC";
    const interval = m.publish_interval_seconds
      ? `${m.publish_interval_seconds * 1000}UL`
      : `defaultIntervalMs(${mode})`;
    const deadband = `${Number(m.publish_deadband ?? 0).toFixed(3)}f`;
    return `  {"${cText(wireId(m))}", "${subtree}/${wireId(m)}", ${isBool}, ${mode}, ${interval}, ${deadband}, NAN, 0, NAN, 0},`;
  })
  .join("\n")}
};
const size_t METRIC_COUNT = sizeof(metrics) / sizeof(metrics[0]);

// Replace each TODO with the real reading. Return NAN to skip this round.
float readMetric(size_t i) {
  switch (i) {
${metricRows
  .map(({ m, isBool, pinConst }, i) =>
    isBool
      ? `    case ${i}: return digitalRead(${pinConst}) == HIGH ? 1.0f : 0.0f;  // TODO: "${cText(m.name)}" — check the pin/logic`
      : `    case ${i}: return 20.0f + random(0, 100) / 10.0f;  // TODO: real reading for "${cText(m.name)}"`,
  )
  .join("\n")}
  }
  return NAN;
}

uint8_t parseMode(const char* publish) {
  if (strcmp(publish, "on_change") == 0) return MODE_ON_CHANGE;
  if (strcmp(publish, "streaming") == 0) return MODE_STREAMING;
  return MODE_PERIODIC;
}

void applyConfig(const byte* payload, unsigned int length) {
  StaticJsonDocument<1024> doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.print("[CONFIG] ignoring malformed config (");
    Serial.print(err.c_str());
    Serial.println(")");
    return;
  }
  for (JsonObject item : doc["metrics"].as<JsonArray>()) {
    const char* key = item["key"] | "";
    for (size_t i = 0; i < METRIC_COUNT; i++) {
      if (strcmp(metrics[i].key, key) != 0) continue;
      metrics[i].mode = parseMode(item["publish"] | "periodic");
      long interval = item["interval_seconds"] | 0L;
      metrics[i].intervalMs = interval > 0 ? (unsigned long)interval * 1000UL : defaultIntervalMs(metrics[i].mode);
      metrics[i].deadband = item["deadband"] | 0.0f;
      Serial.print("[CONFIG] ");
      Serial.print(key);
      Serial.print(" -> ");
      Serial.print(item["publish"] | "periodic");
      Serial.print(", every ");
      Serial.print(metrics[i].intervalMs / 1000);
      Serial.println("s");
    }
  }
}

void publishMetrics() {
  unsigned long now = millis();
  for (size_t i = 0; i < METRIC_COUNT; i++) {
    MetricProfile& m = metrics[i];
    float value = readMetric(i);
    if (isnan(value)) continue;

    // A mechanical switch bounces for a few ms — only accept a stable level.
    if (m.isBool) {
      if (isnan(m.candidate) || value != m.candidate) {
        m.candidate = value;
        m.candidateSinceMs = now;
      }
      if (now - m.candidateSinceMs < BOOL_DEBOUNCE_MS) continue;
    }

    bool first = isnan(m.lastValue);
    unsigned long sinceLast = now - m.lastPublishMs;
    bool send = false;
    const char* reason = "periodic";
    if (first) {
      send = true;
      reason = "initial";
    } else if (m.mode == MODE_ON_CHANGE) {
      bool changed = m.isBool ? value != m.lastValue : fabsf(value - m.lastValue) > m.deadband;
      if (changed && sinceLast >= ON_CHANGE_MIN_GAP_MS) {
        send = true;
        reason = "change";
      } else if (sinceLast >= m.intervalMs) {
        send = true;
        reason = "heartbeat";
      }
    } else {
      send = sinceLast >= m.intervalMs;
    }
    if (!send) continue;

    char payload[48];
    snprintf(payload, sizeof(payload), "{\\"value\\": %.3f}", value);
    bool ok = mqttClient.publish(m.topic, payload);
    // Only record success, so a failed publish is retried next loop.
    if (ok) {
      m.lastValue = value;
      m.lastPublishMs = now;
    }
    Serial.print("[TELEMETRY] ");
    Serial.print(m.key);
    Serial.print(" = ");
    Serial.print(value);
    Serial.print(" (");
    Serial.print(reason);
    Serial.println(ok ? ") ok" : ") FAILED");
  }
}`
    : "";

  const actuatorHandlers = actuatorRows
    .map(({ a, id, type, pinConst }) => {
      const name = cText(a.name);
      const drive =
        type === "bool"
          ? `  bool on = value.is<bool>() ? value.as<bool>() : value.as<float>() != 0;
  digitalWrite(${pinConst}, on ? HIGH : LOW);
  Serial.print("[ACTUATOR] ${name} -> ");
  Serial.println(on ? "ON" : "OFF");`
          : type === "float"
            ? `  float level = value | 0.0f;
  // TODO: drive "${name}" with this level, e.g. analogWrite(${pinConst}, (int)level).
  analogWrite(${pinConst}, (int)level);
  Serial.print("[ACTUATOR] ${name} -> ");
  Serial.println(level);`
            : `  const char* text = value | "";
  // TODO: act on "${name}" = text.
  Serial.print("[ACTUATOR] ${name} -> ");
  Serial.println(text);`;
      return `void setActuator_${id}(JsonVariantConst value) {
${drive}
}

// Command: {"value":..., "issued_at":..., "ttl":..., "command_id":...} — acked.
void handleCommand_${id}(const byte* payload, unsigned int length) {
  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, payload, length)) {
    Serial.println("[CMD] ${name}: malformed payload, dropping");
    return;
  }
  // No RTC here, so issued_at/ttl aren't checked against wall-clock time — wire
  // in NTP (configTime) if you need real staleness rejection.
  setActuator_${id}(doc["value"]);
  const char* commandId = doc["command_id"] | "";
  if (strlen(commandId) > 0) {
    char ack[80];
    snprintf(ack, sizeof(ack), "{\\"command_id\\":\\"%s\\"}", commandId);
    bool acked = mqttClient.publish(TOPIC_ACK_${id}, ack);
    Serial.println(acked ? "  ack sent" : "  ack FAILED to publish");
  }
}

// Retained desired state: delivered on every (re)connect, so the board
// converges to what the platform last asked for. Not acked.
void handleState_${id}(const byte* payload, unsigned int length) {
  StaticJsonDocument<128> doc;
  if (deserializeJson(doc, payload, length)) return;
  setActuator_${id}(doc["value"]);
}`;
    })
    .join("\n\n");

  const callbackBlock = `void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, TOPIC_CONFIG) == 0) {
${hasMetrics ? "    applyConfig(payload, length);\n" : "    // No metrics on this device — nothing to configure.\n"}    return;
  }
${actuatorRows
  .map(
    ({ id }) => `  if (strcmp(topic, TOPIC_CMD_${id}) == 0) {
    handleCommand_${id}(payload, length);
    return;
  }
  if (strcmp(topic, TOPIC_STATE_${id}) == 0) {
    handleState_${id}(payload, length);
    return;
  }`,
  )
  .join("\n")}
}`;

  const mqttBlock = `// ---- MQTT ------------------------------------------------------------------
${
  tls
    ? `// Let's Encrypt root that signs the broker's certificate (infra/PROD_DEPLOY.md §7).
const char* ROOT_CA = R"EOF(
${ISRG_ROOT_X1}
)EOF";

WiFiClientSecure netClient;`
    : "WiFiClient netClient;"
}
PubSubClient mqttClient(netClient);
unsigned long lastStatusMs = 0;

// Retained health snapshot. The Last-Will set in connectMqtt() replaces it with
// {"online":false} if the board drops off — that's how the platform knows it's
// offline even when it has no metrics to go quiet on.
void publishStatus() {
  char payload[160];
  snprintf(payload, sizeof(payload),
           "{\\"online\\":true,\\"rssi\\":%d,\\"uptime_s\\":%lu,\\"fw_version\\":\\"%s\\"}",
           (int)WiFi.RSSI(), millis() / 1000UL, FW_VERSION);
  mqttClient.publish(TOPIC_STATUS, payload, true);
  lastStatusMs = millis();
}

void connectMqtt() {
  while (!mqttClient.connected()) {
    if (WiFi.status() != WL_CONNECTED) connectWifi();
    Serial.print("[MQTT] connecting as ");
    Serial.print(MQTT_USERNAME);
    Serial.print(" ... ");
    if (mqttClient.connect(MQTT_USERNAME, MQTT_USERNAME, MQTT_PASSWORD, TOPIC_STATUS, 1, true,
                           "{\\"online\\":false}")) {
      Serial.println("connected");
      publishStatus();
      mqttClient.subscribe(TOPIC_CONFIG, 1);
${actuatorRows
  .map(
    ({ id }) => `      mqttClient.subscribe(TOPIC_CMD_${id}, 1);
      mqttClient.subscribe(TOPIC_STATE_${id}, 1);`,
  )
  .join("\n")}
    } else {
      Serial.print("failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" retrying in 2s");
      delay(2000);
    }
  }
}`;

  const pinModes = [
    ...metricRows.filter((r) => r.isBool).map((r) => `  pinMode(${r.pinConst}, INPUT_PULLUP);`),
    ...actuatorRows.filter((r) => r.pin !== null).map((r) => `  pinMode(${r.pinConst}, OUTPUT);`),
  ].join("\n");

  const setupLoop = `void setup() {
  Serial.begin(115200);
${pinModes ? `${pinModes}\n` : ""}
${
  phone
    ? `${isC3 ? '  esp_log_level_set("protocomm_nimble", ESP_LOG_NONE);\n' : ""}  pinMode(BOOT_PIN, INPUT_PULLUP);
  provisioningBegin();
`
    : `${isC3 ? "  WiFi.onEvent(onWifiEvent);\n" : ""}  connectWifi();
`
}${tls ? "  netClient.setCACert(ROOT_CA);\n" : ""}  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  // The retained config message doesn't fit PubSubClient's default 256 bytes.
  mqttClient.setBufferSize(1024);
  mqttClient.setCallback(mqttCallback);
}

void loop() {
${
  phone
    ? `  watchProvisioningReset();
  if (WiFi.status() != WL_CONNECTED) {
    delay(100);  // provisioning, or (re)connecting to the stored Wi-Fi
    return;
  }
`
    : ""
}  if (!mqttClient.connected()) connectMqtt();
  mqttClient.loop();
${hasMetrics ? "  publishMetrics();\n" : ""}  if (millis() - lastStatusMs >= STATUS_INTERVAL_MS) publishStatus();
  delay(20);
}`;

  return [
    header,
    includes,
    settingsBlock,
    pinsBlock,
    // Forward declarations: the BLE and MQTT sections call across each other.
    `void connectWifi();
extern PubSubClient mqttClient;`,
    wifiBlock,
    metricsBlock,
    actuatorHandlers,
    callbackBlock,
    mqttBlock,
    setupLoop,
  ]
    .filter((section) => section.trim() !== "")
    .join("\n\n")
    .concat("\n");
}
