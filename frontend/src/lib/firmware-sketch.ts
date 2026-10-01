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
 * - BLE Wi-Fi provisioning (docs/ble-provisioning.md) when no Wi-Fi is stored.
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

// Fixed platform-wide GATT UUIDs — the contract with the provisioning app
// (docs/ble-provisioning.md). Never change them without updating that doc and
// every app build that talks to already-flashed boards.
export const PROV_SERVICE_UUID = "6e1f0001-7c3a-4b8e-9d2f-5a4b3c2d1e0f";
const PROV_UUIDS = {
  ssid: "6e1f0002-7c3a-4b8e-9d2f-5a4b3c2d1e0f",
  password: "6e1f0003-7c3a-4b8e-9d2f-5a4b3c2d1e0f",
  control: "6e1f0004-7c3a-4b8e-9d2f-5a4b3c2d1e0f",
  status: "6e1f0005-7c3a-4b8e-9d2f-5a4b3c2d1e0f",
  info: "6e1f0006-7c3a-4b8e-9d2f-5a4b3c2d1e0f",
};

// Default GPIOs, handed out in order — inputs and outputs from separate pools
// so a generated sketch never wires two things to one pin. Every one is a
// plain GPIO on an ESP32 DevKit (no strapping/flash pins).
const INPUT_PINS = [4, 5, 13, 14, 16, 17, 18, 19];
const OUTPUT_PINS = [2, 23, 22, 21, 27, 26, 25, 33];

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
  /** Advertised over BLE while provisioning, so the app can list the board. */
  deviceName: string;
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
   * binary). Omitted → the board provisions over BLE. */
  wifi?: { ssid: string; password: string };
  /** GPIO overrides keyed "m:<metric id>" (bool inputs) / "a:<actuator id>"
   * (outputs); anything not given uses defaultPins(). */
  pins?: Record<string, number>;
}

/** Every GPIO the pickers offer — the input and output pools together. */
export const PIN_CHOICES: readonly number[] = [...new Set([...INPUT_PINS, ...OUTPUT_PINS])].sort((a, b) => a - b);

/** Pins handed out in order: bool metrics from the input pool, non-string
 * actuators from the output pool, so the defaults never clash. */
export function defaultPins(metrics: SketchMetric[], actuators: SketchActuator[]): Record<string, number> {
  const out: Record<string, number> = {};
  let i = 0;
  let o = 0;
  for (const m of metrics) if (m.data_type === "bool") out[`m:${wireId(m)}`] = INPUT_PINS[i++] ?? 0;
  for (const a of actuators) if ((a.value_type ?? "bool") !== "string") out[`a:${wireId(a)}`] = OUTPUT_PINS[o++] ?? 0;
  return out;
}

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
  const bleName = cText((info.deviceName || deviceSlug).slice(0, 20));

  const username = info.credential?.username ?? CREDENTIAL_PLACEHOLDER;
  const password = info.credential?.password ?? CREDENTIAL_PLACEHOLDER;

  const pins = { ...defaultPins(metrics, actuators), ...(info.pins ?? {}) };

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

  const header = `// Generated for device "${cText(info.deviceName || deviceSlug)}" (${subtree}).
//
// Libraries (Arduino Library Manager): PubSubClient by Nick O'Leary, ArduinoJson
// by Benoit Blanchon. Board: "ESP32 Dev Module".
// Tools > Partition Scheme > "Huge APP (3MB No OTA/1MB SPIFFS)" — BLE + Wi-Fi
// don't fit the default 1.2MB app partition.
//
// First boot: with no Wi-Fi stored, the board starts BLE provisioning and waits
// for the SSID/password (docs/ble-provisioning.md). Once connected they are
// kept in flash. To provision again, re-upload with Tools > "Erase All Flash
// Before Sketch Upload" enabled.`;

  const includes = `#include <WiFi.h>
${tls ? "#include <WiFiClientSecure.h>\n" : ""}#include <Preferences.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <BLESecurity.h>`;

  const settingsBlock = `const char* FW_VERSION = "${FW_VERSION}";
const char* BLE_DEVICE_NAME = "${bleName}";

// Development shortcut: if set, these are used (and saved) when no Wi-Fi has
// been provisioned yet, skipping BLE. Leave empty to provision over BLE.
const char* DEV_WIFI_SSID = "${cText(info.wifi?.ssid ?? "")}";
const char* DEV_WIFI_PASSWORD = "${cText(info.wifi?.password ?? "")}";

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

  const bleBlock = `// ---- BLE Wi-Fi provisioning (docs/ble-provisioning.md) ----------------------
#define PROV_SERVICE_UUID "${PROV_SERVICE_UUID}"
#define PROV_SSID_UUID "${PROV_UUIDS.ssid}"
#define PROV_PASSWORD_UUID "${PROV_UUIDS.password}"
#define PROV_CONTROL_UUID "${PROV_UUIDS.control}"
#define PROV_STATUS_UUID "${PROV_UUIDS.status}"
#define PROV_INFO_UUID "${PROV_UUIDS.info}"

bool provisioningMode = false;
volatile bool provApplyRequested = false;
String provSsid;
String provPassword;
BLECharacteristic* provStatusChar = nullptr;

void setProvStatus(const char* state, const char* reason) {
  char json[96];
  snprintf(json, sizeof(json), "{\\"state\\":\\"%s\\",\\"reason\\":\\"%s\\"}", state, reason);
  Serial.print("[PROV] status ");
  Serial.println(json);
  if (provStatusChar != nullptr) {
    provStatusChar->setValue(json);
    provStatusChar->notify();
  }
}

// getValue() is std::string on ESP32 core 2.x and String on 3.x — c_str()
// works on both.
class ProvSsidCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = c->getValue().c_str();
    if (v.length() == 0 || v.length() > 32) {
      setProvStatus("failed", "invalid_ssid");
      return;
    }
    provSsid = v;
  }
};

class ProvPasswordCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = c->getValue().c_str();
    if (v.length() > 64) {
      setProvStatus("failed", "invalid_password");
      return;
    }
    provPassword = v;
  }
};

class ProvControlCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = c->getValue().c_str();
    // 0x01 = apply. The connect attempt runs in loop(), never in a BLE callback.
    if (v.length() >= 1 && (uint8_t)v[0] == 0x01) provApplyRequested = true;
  }
};

BLECharacteristic* addProvCharacteristic(BLEService* service, const char* uuid, uint32_t props) {
  BLECharacteristic* c = service->createCharacteristic(uuid, props);
  // Writes need an encrypted (bonded) link, so the Wi-Fi password never
  // crosses the air in the clear.
  c->setAccessPermissions(ESP_GATT_PERM_READ_ENCRYPTED | ESP_GATT_PERM_WRITE_ENCRYPTED);
  return c;
}

void startProvisioning() {
  provisioningMode = true;
  Serial.print("[PROV] no Wi-Fi stored, advertising over BLE as ");
  Serial.println(BLE_DEVICE_NAME);

  BLEDevice::init(BLE_DEVICE_NAME);
  // The encrypted-only characteristic permissions below make the phone pair on
  // first access; these settings make that pairing bonded Secure Connections.
  BLESecurity* security = new BLESecurity();
  security->setAuthenticationMode(ESP_LE_AUTH_REQ_SC_BOND);
  security->setCapability(ESP_IO_CAP_NONE);
  security->setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);

  BLEServer* server = BLEDevice::createServer();
  BLEService* service = server->createService(PROV_SERVICE_UUID);

  addProvCharacteristic(service, PROV_SSID_UUID, BLECharacteristic::PROPERTY_WRITE)
      ->setCallbacks(new ProvSsidCallbacks());
  addProvCharacteristic(service, PROV_PASSWORD_UUID, BLECharacteristic::PROPERTY_WRITE)
      ->setCallbacks(new ProvPasswordCallbacks());
  addProvCharacteristic(service, PROV_CONTROL_UUID, BLECharacteristic::PROPERTY_WRITE)
      ->setCallbacks(new ProvControlCallbacks());
  provStatusChar = addProvCharacteristic(
      service, PROV_STATUS_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  provStatusChar->addDescriptor(new BLE2902());

  BLECharacteristic* infoChar =
      addProvCharacteristic(service, PROV_INFO_UUID, BLECharacteristic::PROPERTY_READ);
  char info[192];
  snprintf(info, sizeof(info), "{\\"device_id\\":\\"%s\\",\\"topic_prefix\\":\\"${subtree}\\",\\"fw_version\\":\\"%s\\"}",
           MQTT_USERNAME, FW_VERSION);
  infoChar->setValue(info);

  service->start();
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(PROV_SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
  setProvStatus("idle", "");
}

void loopProvisioning() {
  if (!provApplyRequested) {
    delay(50);
    return;
  }
  provApplyRequested = false;
  if (provSsid.length() == 0) {
    setProvStatus("failed", "missing_ssid");
    return;
  }
  setProvStatus("connecting", "");
  if (tryConnectWifi(provSsid, provPassword)) {
    saveWifi(provSsid, provPassword);
    setProvStatus("connected", "");
    delay(1000);  // let the notification reach the app before rebooting
    ESP.restart();
  }
  WiFi.disconnect(true);
  setProvStatus("failed", "wifi_connect_failed");
}`;

  const wifiBlock = `// ---- Wi-Fi (credentials live in flash, written by BLE provisioning) --------
Preferences prefs;
String wifiSsid;
String wifiPassword;

void saveWifi(const String& ssid, const String& password) {
  prefs.begin("iot", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", password);
  prefs.end();
}

bool loadWifi() {
  prefs.begin("iot", true);
  wifiSsid = prefs.getString("ssid", "");
  wifiPassword = prefs.getString("pass", "");
  prefs.end();
  if (wifiSsid.length() == 0 && strlen(DEV_WIFI_SSID) > 0) {
    wifiSsid = DEV_WIFI_SSID;
    wifiPassword = DEV_WIFI_PASSWORD;
    saveWifi(wifiSsid, wifiPassword);
  }
  return wifiSsid.length() > 0;
}

bool tryConnectWifi(const String& ssid, const String& password) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), password.c_str());
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
  }
  return WiFi.status() == WL_CONNECTED;
}

void connectWifi() {
  while (true) {
    Serial.print("[WiFi] connecting to ");
    Serial.println(wifiSsid);
    if (tryConnectWifi(wifiSsid, wifiPassword)) break;
    Serial.println("[WiFi] failed, retrying");
    WiFi.disconnect(true);
  }
  WiFi.setAutoReconnect(true);
  Serial.print("[WiFi] connected, IP: ");
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
  if (!loadWifi()) {
    startProvisioning();
    return;
  }
  connectWifi();
${tls ? "  netClient.setCACert(ROOT_CA);\n" : ""}  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  // The retained config message doesn't fit PubSubClient's default 256 bytes.
  mqttClient.setBufferSize(1024);
  mqttClient.setCallback(mqttCallback);
}

void loop() {
  if (provisioningMode) {
    loopProvisioning();
    return;
  }
  if (!mqttClient.connected()) connectMqtt();
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
    `bool tryConnectWifi(const String& ssid, const String& password);
void saveWifi(const String& ssid, const String& password);
void connectWifi();
extern PubSubClient mqttClient;`,
    wifiBlock,
    bleBlock,
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
