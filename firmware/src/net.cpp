#include "net.h"

#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_wifi.h>
#include <soc/soc_caps.h>

#include <ArduinoJson.h>

#include "board.h"
#include "command_math.h"
#include "diag.h"
#include "health.h"
#include "io.h"
#include "provisioning.h"
#include "root_ca.h"
#include "version.h"

#if SOC_BT_SUPPORTED
// Keep the Bluetooth controller's RAM reserved, or BLE provisioning crashes at boot.
extern "C" bool btInUse() { return true; }
#endif

namespace {

constexpr unsigned long STATUS_INTERVAL_MS = 60000;
// A changed fault list goes out at once, but not more often than this.
constexpr unsigned long STATUS_MIN_GAP_MS = 5000;
constexpr unsigned long RESET_HOLD_MS = 5000;

// MQTT reconnects back off 2 s, 4 s, 8 s ... up to a minute, so a broker
// that's down isn't hammered by every board at once.
constexpr unsigned long MQTT_RETRY_MIN_MS = 2000;
constexpr unsigned long MQTT_RETRY_MAX_MS = 60000;
// The TLS handshake blocks the loop; keep it well under the watchdog (main.cpp).
constexpr unsigned long TLS_HANDSHAKE_TIMEOUT_S = 15;

// Wi-Fi supervisor. The Arduino core retries a failed join once, then only
// for some reasons (not AUTH_FAIL), and then waits forever: the board blinked
// "connecting" until it was unplugged. So: with no IP this long after boot or
// a drop, rejoin whatever the reason, backing off 30 s, 60 s, then every 2 min;
// and restart the board after 5 min without Wi-Fi.
constexpr unsigned long WIFI_RETRY_FIRST_MS = 30000;
constexpr unsigned long WIFI_RETRY_MAX_MS = 120000;
constexpr unsigned long WIFI_RESTART_MS = 5UL * 60 * 1000;
// Wi-Fi up but no broker for this long: restart, in case the network stack is
// what's stuck. Longer than Wi-Fi's, since this is usually the server.
constexpr unsigned long MQTT_RESTART_MS = 15UL * 60 * 1000;
// Network time (SNTP), started once Wi-Fi is up: lets a command's TTL be
// checked (io.cpp). Several servers, so one being unreachable doesn't matter.
constexpr const char* NTP_SERVERS[] = {"pool.ntp.org", "time.google.com", "time.cloudflare.com"};

// Don't repeat the same disconnect reason more often than this.
constexpr unsigned long WIFI_LOG_REPEAT_MS = 30000;

const DeviceConfig* cfg = nullptr;
WiFiClient plainClient;
WiFiClientSecure tlsClient;
PubSubClient mqtt;
String statusTopic;
unsigned long lastStatusMs = 0;
uint32_t publishedFaultsVersion = 0;
unsigned long lastMqttAttemptMs = 0;
unsigned long mqttRetryMs = MQTT_RETRY_MIN_MS;
bool mqttAttempted = false;
unsigned long mqttDownSince = 0;  // 0 = connected, or Wi-Fi isn't up yet
unsigned long resetDownSince = 0;
// Set once the reset button has read released: a pin held low from boot (bad
// wiring, a jumper) must not wipe the Wi-Fi again on every restart.
bool resetArmed = false;
bool sntpStarted = false;
bool clockLogged = false;
unsigned long wifiDownSince = 0;  // 0 = connected
unsigned long wifiRetryMs = WIFI_RETRY_FIRST_MS;
unsigned long nextWifiRetryAt = 0;
// The last disconnect reason logged, and when (from the Wi-Fi event task).
volatile uint8_t lastWifiReason = 0;
volatile unsigned long lastWifiReasonLogMs = 0;
// Advertising over BLE and waiting for the phone app. Set from the Wi-Fi
// event task, read from loop(), hence volatile.
volatile bool provisioning = false;

void onWifiEvent(arduino_event_t* e) {
  switch (e->event_id) {
    case ARDUINO_EVENT_PROV_START:
      provisioning = true;
      Serial.printf("[PROV] no Wi-Fi stored, advertising over BLE as %s\n", cfg->provName);
      break;
    case ARDUINO_EVENT_PROV_END:
      provisioning = false;
      break;
    case ARDUINO_EVENT_PROV_CRED_RECV:
      Serial.println("[PROV] Wi-Fi received from the app");
      break;
    case ARDUINO_EVENT_PROV_CRED_FAIL:
      // Forget the network that failed, so it isn't retried after a restart,
      // and accept the next try from the app in the same session.
      if (provisioningRetryAfterFailure()) {
        Serial.println("[PROV] couldn't join that network; forgot it, waiting for the app to send it again");
      } else {
        Serial.println("[PROV] couldn't join that network; hold the reset button 5 s to set it up again");
      }
      break;
    case ARDUINO_EVENT_PROV_CRED_SUCCESS:
      provisioning = false;
      Serial.println("[PROV] Wi-Fi saved");
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      provisioning = false;
      diagNoteWifiConnected();
      Serial.print("[WIFI] connected, IP: ");
      Serial.println(WiFi.localIP());
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
      // Why the join failed or the link dropped (e.g. AUTH_FAIL, NO_AP_FOUND).
      // Our own disconnect before a rejoin (ASSOC_LEAVE) isn't news.
      uint8_t reason = e->event_info.wifi_sta_disconnected.reason;
      if (reason == WIFI_REASON_ASSOC_LEAVE) break;
      unsigned long now = millis();
      if (reason != lastWifiReason || now - lastWifiReasonLogMs >= WIFI_LOG_REPEAT_MS) {
        Serial.printf("[WIFI] disconnected: %s (%u)\n", WiFi.disconnectReasonName((wifi_err_reason_t)reason), reason);
        lastWifiReason = reason;
        lastWifiReasonLogMs = now;
      }
      break;
    }
#if CONFIG_IDF_TARGET_ESP32C3
    // ESP32-C3 boards (the Super Mini especially) fail to authenticate or run
    // hot at full TX power; 8.5 dBm is plenty for a nearby access point.
    case ARDUINO_EVENT_WIFI_STA_START:
      WiFi.setTxPower(WIFI_POWER_8_5dBm);
      break;
#endif
    default:
      break;
  }
}

// Hold the reset button 5 s while running: forget the Wi-Fi and provision
// again. A board whose Wi-Fi was typed into its config has nothing to forget,
// so it just restarts (run Install again to change its network). (Holding it
// while powering up starts the bootloader instead.)
void watchResetButton() {
  if (digitalRead(cfg->resetPin) != LOW) {
    resetArmed = true;
    resetDownSince = 0;
    return;
  }
  if (!resetArmed) return;  // held low since boot: ignored until released
  if (resetDownSince == 0) resetDownSince = millis();
  if (millis() - resetDownSince < RESET_HOLD_MS) return;
  if (cfg->wifiSsid != nullptr) {
    Serial.println("[WIFI] reset button held: restarting (this board's Wi-Fi is in its config)");
  } else {
    Serial.println("[PROV] reset button held: forgetting Wi-Fi and restarting");
    WiFi.disconnect(false, true);  // erase the stored network only
  }
  delay(100);
  ESP.restart();
}

// A station network is set (saved, typed in, or just provisioned), so there's
// something to rejoin. False while the board waits for the phone.
bool haveWifiToJoin() {
  if (provisioning) return false;
  wifi_config_t conf;
  return esp_wifi_get_config(WIFI_IF_STA, &conf) == ESP_OK && conf.sta.ssid[0] != 0;
}

// The Wi-Fi supervisor (see WIFI_RETRY_FIRST_MS). Returns true when Wi-Fi is up.
bool superviseWifi() {
  unsigned long now = millis();
  if (WiFi.status() == WL_CONNECTED) {
    if (wifiDownSince != 0) {
      wifiDownSince = 0;
      wifiRetryMs = WIFI_RETRY_FIRST_MS;
    }
    return true;
  }
  if (!haveWifiToJoin()) {
    wifiDownSince = 0;  // the clock starts once there's a network to join
    return false;
  }
  if (wifiDownSince == 0) {
    wifiDownSince = now;
    nextWifiRetryAt = now + wifiRetryMs;
    return false;
  }
  if (now - wifiDownSince >= WIFI_RESTART_MS) {
    Serial.printf("[WIFI] no Wi-Fi for %lu min; restarting\n", WIFI_RESTART_MS / 60000);
    delay(100);
    ESP.restart();
  }
  if ((long)(now - nextWifiRetryAt) >= 0) {
    Serial.printf("[WIFI] still not connected after %lus; joining again\n", (now - wifiDownSince) / 1000);
    esp_wifi_disconnect();
    esp_wifi_connect();
    wifiRetryMs = min(wifiRetryMs * 2, WIFI_RETRY_MAX_MS);
    nextWifiRetryAt = now + wifiRetryMs;
  }
  return false;
}

// Retained health snapshot (CLAUDE.md §4). The Last-Will set on connect
// replaces it with {"online":false} if the board drops off. The diagnostics
// (0.14.0) are optional fields: platforms before them ignore them.
void publishStatus() {
  JsonDocument doc;
  doc["online"] = true;
  doc["rssi"] = (int)WiFi.RSSI();
  doc["uptime_s"] = millis() / 1000UL;
  doc["fw_version"] = FW_VERSION;
  doc["reset_reason"] = diagResetReason();
  doc["boot_count"] = diagBootCount();
  doc["heap_free"] = ESP.getFreeHeap();
  doc["heap_min"] = ESP.getMinFreeHeap();
  doc["wifi_reconnects"] = diagWifiReconnects();
  JsonArray faults = doc["faults"].to<JsonArray>();
  // At most 6 (of up to 8 kept): ~65 bytes each keeps the message inside
  // PubSubClient's 1024-byte buffer with the topic.
  for (size_t i = 0; i < sensorFaultCount() && i < 6; i++) faults.add(sensorFaultText(i));
  char payload[800];
  size_t len = serializeJson(doc, payload, sizeof(payload));
  mqtt.publish(statusTopic.c_str(), (const uint8_t*)payload, len, true);
  lastStatusMs = millis();
  publishedFaultsVersion = sensorFaultsVersion();
}

void onMessage(char* topic, uint8_t* payload, unsigned int length) { ioHandleMessage(mqtt, topic, payload, length); }

void tryConnectMqtt() {
  mqttAttempted = true;
  lastMqttAttemptMs = millis();
  Serial.printf("[MQTT] connecting as %s ... ", cfg->mqttUsername);
  if (mqtt.connect(cfg->mqttUsername, cfg->mqttUsername, cfg->mqttPassword, statusTopic.c_str(), 1, true,
                   "{\"online\":false}")) {
    // Free heap, once per connect: the headroom drivers have to work with.
    Serial.printf("connected (free heap %u KB)\n", (unsigned)(ESP.getFreeHeap() / 1024));
    mqttRetryMs = MQTT_RETRY_MIN_MS;
    mqttDownSince = 0;
    publishStatus();
    ioSubscribe(mqtt);
  } else {
    Serial.printf("failed, rc=%d, retrying in %lus\n", mqtt.state(), mqttRetryMs / 1000);
  }
}

// SNTP once Wi-Fi is up (it keeps itself in sync from then on, every hour);
// says once when the time is known. UTC: the device contract's times are Unix.
void watchClock() {
  if (!sntpStarted) {
    configTime(0, 0, NTP_SERVERS[0], NTP_SERVERS[1], NTP_SERVERS[2]);
    sntpStarted = true;
  }
  if (clockLogged) return;
  time_t now = time(nullptr);
  if ((int64_t)now < CLOCK_VALID_AFTER) return;
  struct tm t;
  gmtime_r(&now, &t);
  Serial.printf("[TIME] synced: %04d-%02d-%02d %02d:%02d:%02d UTC\n", t.tm_year + 1900, t.tm_mon + 1, t.tm_mday, t.tm_hour,
                t.tm_min, t.tm_sec);
  clockLogged = true;
}

// MQTT (re)connects with back-off, and a restart if the broker stays out of
// reach for MQTT_RESTART_MS while Wi-Fi is up.
void superviseMqtt() {
  unsigned long now = millis();
  if (mqttDownSince == 0) mqttDownSince = now;
  if (now - mqttDownSince >= MQTT_RESTART_MS) {
    Serial.printf("[MQTT] no broker for %lu min with Wi-Fi up; restarting\n", MQTT_RESTART_MS / 60000);
    delay(100);
    ESP.restart();
  }
  if (!mqttAttempted) {
    tryConnectMqtt();
  } else if (now - lastMqttAttemptMs >= mqttRetryMs) {
    // The wait before this attempt grows only after a failure.
    mqttRetryMs = min(mqttRetryMs * 2, MQTT_RETRY_MAX_MS);
    tryConnectMqtt();
  }
}

}  // namespace

void netBegin(const DeviceConfig& config) {
  cfg = &config;
  statusTopic = String(config.tenant) + "/" + config.device + "/status";

  if (config.tls) {
    tlsClient.setCACert(ROOT_CA);
    tlsClient.setHandshakeTimeout(TLS_HANDSHAKE_TIMEOUT_S);
    mqtt.setClient(tlsClient);
  } else {
    mqtt.setClient(plainClient);
  }
  mqtt.setServer(config.mqttHost, config.mqttPort);
  // The retained config message doesn't fit PubSubClient's default 256 bytes.
  mqtt.setBufferSize(1024);
  mqtt.setCallback(onMessage);

  WiFi.onEvent(onWifiEvent);
  if (config.wifiSsid != nullptr) {
    // Bench test: Wi-Fi typed into the config. It's readable from the flash.
    Serial.printf("[WIFI] connecting to %s\n", config.wifiSsid);
    // Never into the board's own Wi-Fi store: a later phone-setup config would
    // find it there and skip BLE.
    WiFi.persistent(false);
    pinMode(config.resetPin, INPUT_PULLUP);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(config.wifiSsid, config.wifiPassword);
    return;
  }

#if SOC_BT_SUPPORTED
#if CONFIG_IDF_TARGET_ESP32C3
  esp_log_level_set("protocomm_nimble", ESP_LOG_NONE);
#endif
  pinMode(config.resetPin, INPUT_PULLUP);
  // Connects with the Wi-Fi stored in NVS, or advertises over BLE if there is
  // none. Returns at once; netLoop() waits for the connection.
  String err;
  if (!provisioningBegin(config, err)) {
    // The LED stays on its connecting pattern; the reset button still works.
    Serial.printf("[PROV] %s; hold the reset button 5 s to try again\n", err.c_str());
  }
#endif
  // Without Bluetooth, loadConfig() already refused a config with no Wi-Fi.
}

void netLoop() {
  watchResetButton();
  if (!superviseWifi()) {
    mqttDownSince = 0;  // the broker's clock runs only while Wi-Fi is up
    return;              // provisioning, or (re)joining
  }
  watchClock();

  if (!mqtt.connected()) {
    superviseMqtt();
    return;
  }
  mqtt.loop();
  ioPublishMetrics(mqtt);
  unsigned long sinceStatus = millis() - lastStatusMs;
  if (sinceStatus >= STATUS_INTERVAL_MS ||
      (sensorFaultsVersion() != publishedFaultsVersion && sinceStatus >= STATUS_MIN_GAP_MS))
    publishStatus();
}

NetState netState() {
  if (provisioning) return NetState::Provisioning;
  if (WiFi.status() != WL_CONNECTED || !mqtt.connected()) return NetState::Connecting;
  return NetState::Connected;
}
