#include "net.h"

#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include "board.h"
#include "io.h"
#include "provisioning.h"
#include "root_ca.h"
#include "version.h"

// Keep the Bluetooth controller's RAM reserved, or BLE provisioning crashes at boot.
extern "C" bool btInUse() { return true; }

namespace {

constexpr unsigned long STATUS_INTERVAL_MS = 60000;
constexpr unsigned long MQTT_RETRY_MS = 2000;
constexpr unsigned long RESET_HOLD_MS = 5000;

const DeviceConfig* cfg = nullptr;
WiFiClient plainClient;
WiFiClientSecure tlsClient;
PubSubClient mqtt;
String statusTopic;
unsigned long lastStatusMs = 0;
unsigned long lastMqttAttemptMs = 0;
bool mqttAttempted = false;
unsigned long resetDownSince = 0;
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
      Serial.println("[PROV] couldn't join that network; check the password and send it again");
      break;
    case ARDUINO_EVENT_PROV_CRED_SUCCESS:
      provisioning = false;
      Serial.println("[PROV] Wi-Fi saved");
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      provisioning = false;
      Serial.print("[WIFI] connected, IP: ");
      Serial.println(WiFi.localIP());
      break;
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
// again. (Holding it while powering up starts the bootloader instead.)
void watchProvisioningReset() {
  if (digitalRead(cfg->resetPin) != LOW) {
    resetDownSince = 0;
    return;
  }
  if (resetDownSince == 0) resetDownSince = millis();
  if (millis() - resetDownSince >= RESET_HOLD_MS) {
    Serial.println("[PROV] reset button held: forgetting Wi-Fi and restarting");
    WiFi.disconnect(false, true);  // erase the stored network only
    delay(100);
    ESP.restart();
  }
}

// Retained health snapshot. The Last-Will set on connect replaces it with
// {"online":false} if the board drops off.
void publishStatus() {
  char payload[160];
  snprintf(payload, sizeof(payload), "{\"online\":true,\"rssi\":%d,\"uptime_s\":%lu,\"fw_version\":\"%s\"}",
           (int)WiFi.RSSI(), millis() / 1000UL, FW_VERSION);
  mqtt.publish(statusTopic.c_str(), payload, true);
  lastStatusMs = millis();
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
    publishStatus();
    ioSubscribe(mqtt);
  } else {
    Serial.printf("failed, rc=%d, retrying in 2s\n", mqtt.state());
  }
}

}  // namespace

void netBegin(const DeviceConfig& config) {
  cfg = &config;
  statusTopic = String(config.tenant) + "/" + config.device + "/status";

  if (config.tls) {
    tlsClient.setCACert(ROOT_CA);
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
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(config.wifiSsid, config.wifiPassword);
    return;
  }

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
}

void netLoop() {
  if (cfg->wifiSsid == nullptr) watchProvisioningReset();
  if (WiFi.status() != WL_CONNECTED) return;  // provisioning, or (re)connecting

  if (!mqtt.connected()) {
    if (!mqttAttempted || millis() - lastMqttAttemptMs >= MQTT_RETRY_MS) tryConnectMqtt();
    return;
  }
  mqtt.loop();
  ioPublishMetrics(mqtt);
  if (millis() - lastStatusMs >= STATUS_INTERVAL_MS) publishStatus();
}

NetState netState() {
  if (provisioning) return NetState::Provisioning;
  if (WiFi.status() != WL_CONNECTED || !mqtt.connected()) return NetState::Connecting;
  return NetState::Connected;
}
