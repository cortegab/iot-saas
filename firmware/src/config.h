#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include <vector>

#include "board.h"

// The per-device config the dashboard writes into the `cfg` partition.
//
// Layout (all little-endian), then 0xFF padding to the end of the partition:
//   0  magic    "IOCF"
//   4  version  u16 = 1
//   6  reserved u16 = 0
//   8  length   u32, bytes of JSON that follow
//  12  crc32    u32, CRC-32 (IEEE) of those JSON bytes
//  16  JSON     (schema: frontend/src/lib/hardware/config-blob.ts)
//
// The browser's writer is frontend/src/lib/hardware/config-blob.ts; the two
// share the test vector in firmware/test/config-vector.json.
struct DeviceConfig {
  // The board model the dashboard wired this for (firmware/boards.json), for
  // the log only; "" when absent. `board` (the chip) is what's checked.
  const char* model;

  const char* tenant;
  const char* device;

  const char* mqttHost;
  uint16_t mqttPort;
  bool tls;
  const char* mqttUsername;
  const char* mqttPassword;

  // Phone provisioning (BLE), unless wifiSsid is set (a bench-test shortcut).
  const char* provName;
  uint8_t provSecurity;  // 1 or 2
  std::vector<uint8_t> sec2Salt;
  std::vector<uint8_t> sec2Verifier;
  const char* wifiSsid;  // nullptr = provision from a phone
  const char* wifiPassword;

  int i2cSda;  // -1 = no I2C bus
  int i2cScl;

  // The board model's reset button and status LED (`board_io`); the chip's
  // defaults (board.h) for a config written before board_io existed.
  int resetPin;
  LedType ledType;
  int ledPin;  // -1 with LedType::None
  bool ledActiveLow;

  JsonArrayConst metrics;    // [{key, bool, publish, interval_s, deadband}]
  JsonArrayConst actuators;  // [{key, type}]
  JsonArrayConst inputs;     // bindings: [{driver, pins, params, channels}]
  JsonArrayConst outputs;
};

// Reads, checks and parses the `cfg` partition. The returned strings and arrays
// point into a document that lives for the whole run. On failure `err` says why
// in words a person flashing the board can act on.
bool loadConfig(DeviceConfig& out, String& err);
