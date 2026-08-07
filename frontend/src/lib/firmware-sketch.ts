/** Generates a ready-to-flash ESP32 Arduino sketch for a device, parameterized
 * by its catalog-declared metrics/actuators — one `publish()` per metric, one
 * subscribe + callback branch per actuator (CLAUDE.md §4's device contract:
 * `{tenant}/{device}/{metric}` telemetry, `{tenant}/{device}/cmd/{actuator}`
 * commands).
 *
 * Shared between the at-creation flow (`devices/new/page.tsx`, which has the
 * real one-time credential in hand) and the device-detail Settings "generate
 * on demand" button (which never does — the credential is shown exactly once
 * and can't be retrieved again, so `credential: null` there emits a
 * placeholder instead of a stale or fabricated secret).
 */

const PLACEHOLDER_METRIC = "temperature";
const CREDENTIAL_PLACEHOLDER = "<paste your device credential here>";

export interface SketchCredential {
  username: string;
  password: string;
}

export interface SketchInfo {
  tenantSlug: string;
  deviceSlug: string;
  host: string;
  /** Declared metrics from the device's catalog entry. Empty (a "Legacy"
   * device) falls back to a single placeholder metric, matching this
   * function's pre-catalog behavior. */
  metrics: { name: string }[];
  /** Declared actuators. Empty generates no subscribe/callback code at all —
   * also matching pre-catalog behavior, which never had any. */
  actuators: { name: string }[];
  /** The real one-time secret at creation, or null to omit it (Settings'
   * on-demand button — see module docstring). */
  credential: SketchCredential | null;
}

function toIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function buildSketch(info: SketchInfo): string {
  const { tenantSlug, deviceSlug, host, actuators } = info;
  const metrics = info.metrics.length > 0 ? info.metrics : [{ name: PLACEHOLDER_METRIC }];

  const username = info.credential?.username ?? CREDENTIAL_PLACEHOLDER;
  const password = info.credential
    ? info.credential.password
    : `${CREDENTIAL_PLACEHOLDER} — see Settings > Rotate credential`;

  const metricTopicLines = metrics
    .map(
      (m) =>
        `const char* TOPIC_METRIC_${toIdentifier(m.name)} = "${tenantSlug}/${deviceSlug}/${m.name}";`,
    )
    .join("\n");

  const actuatorTopicsBlock =
    actuators.length > 0
      ? `\n// Actuator command topics — subscribed to below.\n${actuators
          .map(
            (a) =>
              `const char* TOPIC_CMD_${toIdentifier(a.name)} = "${tenantSlug}/${deviceSlug}/cmd/${a.name}";`,
          )
          .join("\n")}\n`
      : "";

  const publishCalls = metrics
    .map((m) => {
      const id = toIdentifier(m.name);
      return `  {
    // TODO: replace with a real reading for "${m.name}".
    float value_${id} = 20.0 + random(0, 100) / 10.0;
    char payload_${id}[64];
    snprintf(payload_${id}, sizeof(payload_${id}), "{\\"value\\": %.1f}", value_${id});
    mqttClient.publish(TOPIC_METRIC_${id}, payload_${id});
  }`;
    })
    .join("\n");

  const subscribeCalls = actuators
    .map((a) => `      mqttClient.subscribe(TOPIC_CMD_${toIdentifier(a.name)});`)
    .join("\n");

  const callbackFunction =
    actuators.length > 0
      ? `void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];

${actuators
  .map(
    (a) => `  if (strcmp(topic, TOPIC_CMD_${toIdentifier(a.name)}) == 0) {
    // Payload is JSON: {"value":..., "issued_at":..., "ttl":..., "command_id":...} (CLAUDE.md §4).
    // TODO: parse \`message\` and drive "${a.name}".
  }`,
  )
  .join(" else ")}
}

`
      : "";

  return `#include <WiFi.h>
#include <PubSubClient.h>

// Wi-Fi credentials — fill these in.
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// MQTT broker — defaults to this dashboard's own host, since the platform and
// broker share one server. Change MQTT_HOST if your broker lives elsewhere.
// Port 1883 is plaintext, matching this dev deployment; switch to 8883 with
// WiFiClientSecure once TLS is configured in production.
const char* MQTT_HOST = "${host}";
const int MQTT_PORT = 1883;
const char* MQTT_USERNAME = "${username}";
const char* MQTT_PASSWORD = "${password}";

// Telemetry topics — one per declared metric. Rename/add to match whatever
// you're actually measuring; keep names consistent with rules and charts.
${metricTopicLines}
${actuatorTopicsBlock}
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

${callbackFunction}void connectWifi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
}

void connectMqtt() {
  while (!mqttClient.connected()) {
    if (mqttClient.connect(MQTT_USERNAME, MQTT_USERNAME, MQTT_PASSWORD)) {
${subscribeCalls}
    } else {
      delay(2000);
    }
  }
}

void setup() {
  connectWifi();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
${actuators.length > 0 ? "  mqttClient.setCallback(mqttCallback);\n" : ""}}

void loop() {
  if (!mqttClient.connected()) {
    connectMqtt();
  }
  mqttClient.loop();

${publishCalls}

  delay(5000);
}
`;
}
