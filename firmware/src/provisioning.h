#pragma once

#include <Arduino.h>

#include "config.h"

// Wi-Fi from the phone: ESP-IDF's network_provisioning over BLE, called
// directly. It does what Arduino's WiFiProv.beginProvision does for the BLE
// scheme (same service UUID, names, Security 1/2, events), without WiFiProv:
// on the ESP32 that library includes Bluedroid's SimpleBLE.h, which kept the
// firmware on Bluedroid instead of the much smaller NimBLE (firmware/README.md,
// "Size"). Same device contract as before (docs/ble-provisioning.md).
//
// With Wi-Fi saved in NVS it just connects; otherwise it advertises as
// cfg.provName and waits for the app. Returns at once either way; the
// ARDUINO_EVENT_PROV_* / WIFI_* events report what happens next. False, with
// `err`, if provisioning couldn't start.
bool provisioningBegin(const DeviceConfig& cfg, String& err);
