#include "provisioning.h"

#include <soc/soc_caps.h>

// Phone setup is BLE only: a chip without Bluetooth (the S2) builds none of
// this, and its config must carry the Wi-Fi (config.cpp).
#if SOC_BT_SUPPORTED

#include <WiFi.h>
#include <esp_wifi.h>
#include <network_provisioning/manager.h>
#include <network_provisioning/scheme_ble.h>

#include "board.h"

namespace {

// WiFiProv's custom service UUID (Arduino core libraries/WiFiProv), kept so
// the board looks to the phone app exactly as it did under WiFiProv.
uint8_t SERVICE_UUID[16] = {
    0xb4, 0xdf, 0x5a, 0x1c, 0x3f, 0x6b, 0xf4, 0xbf, 0xea, 0x4a, 0x82, 0x03, 0x04, 0x90, 0x1a, 0x02,
};

// Must outlive the call: the provisioning manager keeps a pointer to it.
network_prov_security2_params_t sec2Params;

}  // namespace

bool provisioningBegin(const DeviceConfig& cfg, String& err) {
  network_prov_mgr_config_t config = {};
  config.scheme = network_prov_scheme_ble;
  // Frees the Bluetooth memory once provisioning is over (board.h).
  network_prov_event_handler_t scheme_handler = BLE_HANDLER;
  network_prov_event_handler_t no_handler = NETWORK_PROV_EVENT_HANDLER_NONE;
  config.scheme_event_handler = scheme_handler;
  config.app_event_handler = no_handler;

  WiFi.STA.begin(false);
  if (network_prov_mgr_init(config) != ESP_OK) {
    err = "couldn't start the provisioning manager";
    return false;
  }

  bool provisioned = false;
  if (network_prov_mgr_is_wifi_provisioned(&provisioned) != ESP_OK) {
    network_prov_mgr_deinit();
    err = "couldn't read the saved Wi-Fi";
    return false;
  }
  if (provisioned) {
    // Wi-Fi is saved: connect with it; no BLE at all.
    Serial.println("[WIFI] connecting with the saved Wi-Fi (hold the reset button 5 s to set a new one)");
    esp_wifi_start();
    network_prov_mgr_deinit();
    WiFi.begin();
    return true;
  }

  network_prov_scheme_ble_set_service_uuid(SERVICE_UUID);
  network_prov_security_t security;
  const void* params;
  if (cfg.provSecurity == 2) {
    // The app proves it knows the device's password; the board keeps only the
    // salt and verifier for it (username = the MQTT username).
    sec2Params = {(const char*)cfg.sec2Salt.data(), (uint16_t)cfg.sec2Salt.size(), (const char*)cfg.sec2Verifier.data(),
                  (uint16_t)cfg.sec2Verifier.size()};
    security = NETWORK_PROV_SECURITY_2;
    params = &sec2Params;
  } else {
    // Security 1: the proof of possession is the device's password.
    security = NETWORK_PROV_SECURITY_1;
    params = cfg.mqttPassword;
  }
  if (network_prov_mgr_start_provisioning(security, params, cfg.provName, NULL) != ESP_OK) {
    err = "couldn't start advertising over BLE";
    return false;
  }
  return true;
}

#endif  // SOC_BT_SUPPORTED
