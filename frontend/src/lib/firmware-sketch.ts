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

export interface SketchInfo {
  tenantSlug: string;
  deviceSlug: string;
  host: string;
  /** Whether the dashboard itself is being served over HTTPS. Prod's broker
   * is TLS-only on 8883 with a real Let's Encrypt cert; local dev is
   * plaintext on 1883 (infra/docker-compose.prod.yml vs infra/docker-compose.yml).
   * Drives whether the generated sketch uses WiFiClientSecure or WiFiClient. */
  tls: boolean;
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
  const { tenantSlug, deviceSlug, host, tls, actuators } = info;
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
    bool published_${id} = mqttClient.publish(TOPIC_METRIC_${id}, payload_${id});
    Serial.print("[TELEMETRY] ${m.name} = ");
    Serial.print(value_${id});
    Serial.print(" -> publish ");
    Serial.println(published_${id} ? "ok" : "FAILED");
  }`;
    })
    .join("\n");

  const subscribeCalls = actuators
    .map(
      (a) => `      mqttClient.subscribe(TOPIC_CMD_${toIdentifier(a.name)});
      Serial.print("[MQTT] subscribed to ");
      Serial.println(TOPIC_CMD_${toIdentifier(a.name)});`,
    )
    .join("\n");

  const callbackFunction =
    actuators.length > 0
      ? `void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];

  Serial.print("[MQTT] message on ");
  Serial.print(topic);
  Serial.print(": ");
  Serial.println(message);

  ${actuators
  .map((a) => {
    const id = toIdentifier(a.name);
    return `if (strcmp(topic, TOPIC_CMD_${id}) == 0) {
    // Payload is JSON: {"value":..., "issued_at":..., "ttl":..., "command_id":...} (CLAUDE.md §4).
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, message);
    if (err) {
      Serial.print("[CMD] ${a.name}: malformed payload, dropping (");
      Serial.print(err.c_str());
      Serial.println(")");
      return;
    }

    bool desiredValue = doc["value"] | false;
    long issuedAt = doc["issued_at"] | 0L;
    long ttl = doc["ttl"] | 0L;
    const char* commandId = doc["command_id"] | "unknown";

    // No RTC on this sketch, so issued_at/ttl aren't checked against
    // wall-clock time yet — wire in NTP (configTime) if you need real
    // staleness rejection instead of just logging these fields.
    Serial.println("[CMD] ${a.name}: rule fired on the platform, command received");
    Serial.print("  command_id: ");
    Serial.println(commandId);
    Serial.print("  value:      ");
    Serial.println(desiredValue ? "ON" : "OFF");
    Serial.print("  issued_at:  ");
    Serial.println(issuedAt);
    Serial.print("  ttl:        ");
    Serial.print(ttl);
    Serial.println("s");

    // TODO: drive "${a.name}" here, e.g. digitalWrite(${id.toUpperCase()}_PIN, desiredValue);
  }`;
  })
  .join(" else ")}
}

`
      : "";

  const includesBlock = `#include <WiFi.h>
${tls ? "#include <WiFiClientSecure.h>\n" : ""}#include <PubSubClient.h>
${actuators.length > 0 ? "#include <ArduinoJson.h>\n" : ""}`;

  const mqttCommentBlock = tls
    ? `// MQTT broker — defaults to this dashboard's own host, since the platform and
// broker share one server. Change MQTT_HOST if your broker lives elsewhere.
// This copy was generated from a dashboard served over HTTPS, so it targets
// the production, TLS-only listener on port 8883 — the certificate chain is
// validated for real below (see ROOT_CA), not skipped with setInsecure().`
    : `// MQTT broker — defaults to this dashboard's own host, since the platform and
// broker share one server. Change MQTT_HOST if your broker lives elsewhere.
// Plaintext on port 1883, matching this local/dev deployment (no TLS here).`;

  const clientBlock = tls
    ? `// Let's Encrypt root that signs the broker's certificate (infra/PROD_DEPLOY.md §7).
const char* ROOT_CA = R"EOF(
${ISRG_ROOT_X1}
)EOF";

WiFiClientSecure netClient;`
    : `WiFiClient netClient;`;

  return `${includesBlock}
// Wi-Fi credentials — fill these in.
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

${mqttCommentBlock}
const char* MQTT_HOST = "${host}";
const int MQTT_PORT = ${tls ? 8883 : 1883};
const char* MQTT_USERNAME = "${username}";
const char* MQTT_PASSWORD = "${password}";

// Telemetry topics — one per declared metric. Rename/add to match whatever
// you're actually measuring; keep names consistent with rules and charts.
${metricTopicLines}
${actuatorTopicsBlock}
${clientBlock}
PubSubClient mqttClient(netClient);

${callbackFunction}void connectWifi() {
  Serial.print("[WiFi] connecting to ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("[WiFi] connected, IP: ");
  Serial.println(WiFi.localIP());
}

void connectMqtt() {
  while (!mqttClient.connected()) {
    Serial.print("[MQTT] connecting as ");
    Serial.print(MQTT_USERNAME);
    Serial.print(" ... ");
    if (mqttClient.connect(MQTT_USERNAME, MQTT_USERNAME, MQTT_PASSWORD)) {
      Serial.println("connected");
${subscribeCalls}
    } else {
      Serial.print("failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" retrying in 2s");
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  connectWifi();
${tls ? "  netClient.setCACert(ROOT_CA);\n" : ""}  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
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
