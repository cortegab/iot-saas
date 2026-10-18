#include "config.h"

#include <esp_partition.h>
#include <mbedtls/base64.h>

#include "board.h"
#include "crc32.h"

namespace {

constexpr esp_partition_subtype_t CFG_SUBTYPE = (esp_partition_subtype_t)0x40;
constexpr uint16_t BLOB_VERSION = 1;
constexpr size_t HEADER_SIZE = 16;

// Lives for the whole run: DeviceConfig points into it.
JsonDocument doc;

uint32_t readU32(const uint8_t* p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }
uint16_t readU16(const uint8_t* p) { return p[0] | (p[1] << 8); }

bool decodeBase64(const char* text, std::vector<uint8_t>& out) {
  size_t len = strlen(text);
  size_t outLen = 0;
  out.assign(len, 0);
  if (mbedtls_base64_decode(out.data(), out.size(), &outLen, (const unsigned char*)text, len) != 0) return false;
  out.resize(outLen);
  return outLen > 0;
}

bool requireText(JsonObjectConst obj, const char* key, const char* where, const char*& out, String& err) {
  out = obj[key] | "";
  if (strlen(out) > 0) return true;
  err = String("missing ") + where + "." + key;
  return false;
}

}  // namespace

bool loadConfig(DeviceConfig& out, String& err) {
  const esp_partition_t* part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, CFG_SUBTYPE, "cfg");
  if (part == nullptr) {
    err = "no cfg partition: flash the full firmware, not only the app";
    return false;
  }

  uint8_t header[HEADER_SIZE];
  if (esp_partition_read(part, 0, header, HEADER_SIZE) != ESP_OK) {
    err = "couldn't read the cfg partition";
    return false;
  }
  if (memcmp(header, "IOCF", 4) != 0) {
    err = "no device config yet: install it from the dashboard";
    return false;
  }
  if (readU16(header + 4) != BLOB_VERSION) {
    err = String("config format ") + readU16(header + 4) + " is newer than this firmware; update the firmware";
    return false;
  }
  uint32_t length = readU32(header + 8);
  if (length == 0 || length > part->size - HEADER_SIZE) {
    err = "config length is out of range";
    return false;
  }

  std::vector<uint8_t> json(length);
  if (esp_partition_read(part, HEADER_SIZE, json.data(), length) != ESP_OK) {
    err = "couldn't read the config body";
    return false;
  }
  if (crc32Ieee(json.data(), length) != readU32(header + 12)) {
    err = "config checksum mismatch: install the config again";
    return false;
  }

  DeserializationError parsed = deserializeJson(doc, (const char*)json.data(), length);
  if (parsed) {
    err = String("config isn't valid JSON (") + parsed.c_str() + ")";
    return false;
  }
  JsonObjectConst root = doc.as<JsonObjectConst>();

  if ((root["v"] | 0) != 1) {
    err = "unsupported config version";
    return false;
  }
  const char* board = root["board"] | "";
  if (strcmp(board, BOARD_ID) != 0) {
    err = String("this config is for ") + (strlen(board) ? board : "another board") + ", but this board is " + BOARD_ID;
    return false;
  }

  JsonObjectConst device = root["device"];
  if (!requireText(device, "tenant", "device", out.tenant, err)) return false;
  if (!requireText(device, "device", "device", out.device, err)) return false;
  out.model = root["model"] | "";

  JsonObjectConst mqtt = root["mqtt"];
  if (!requireText(mqtt, "host", "mqtt", out.mqttHost, err)) return false;
  if (!requireText(mqtt, "username", "mqtt", out.mqttUsername, err)) return false;
  if (!requireText(mqtt, "password", "mqtt", out.mqttPassword, err)) return false;
  out.tls = mqtt["tls"] | false;
  out.mqttPort = mqtt["port"] | (out.tls ? 8883 : 1883);

  JsonObjectConst wifi = root["wifi"];
  out.wifiSsid = nullptr;
  out.wifiPassword = "";
  if (!wifi.isNull()) {
    if (!requireText(wifi, "ssid", "wifi", out.wifiSsid, err)) return false;
    out.wifiPassword = wifi["password"] | "";
  }

  JsonObjectConst prov = root["prov"];
  out.provName = prov["name"] | out.device;
  out.provSecurity = prov["security"] | 1;
  if (out.provSecurity != 1 && out.provSecurity != 2) {
    err = "prov.security must be 1 or 2";
    return false;
  }
  if (out.wifiSsid == nullptr && out.provSecurity == 2) {
    if (!decodeBase64(prov["salt"] | "", out.sec2Salt) || !decodeBase64(prov["verifier"] | "", out.sec2Verifier)) {
      err = "Security 2 needs prov.salt and prov.verifier (base64)";
      return false;
    }
  }

  JsonObjectConst i2c = root["i2c"];
  out.i2cSda = i2c["sda"] | -1;
  out.i2cScl = i2c["scl"] | -1;

  // Optional and additive, so older firmware ignores it and this one reads
  // older configs: without it, the chip's defaults.
  JsonObjectConst io = root["board_io"];
  out.resetPin = io["reset_pin"] | DEFAULT_RESET_PIN;
  out.ledType = DEFAULT_LED_TYPE;
  out.ledPin = DEFAULT_LED_PIN;
  out.ledActiveLow = DEFAULT_LED_ACTIVE_LOW;
  JsonObjectConst led = io["led"];
  if (!led.isNull()) {
    const char* type = led["type"] | "gpio";
    if (strcmp(type, "gpio") == 0) {
      out.ledType = LedType::Gpio;
    } else if (strcmp(type, "rgb") == 0) {
      out.ledType = LedType::Rgb;
    } else if (strcmp(type, "none") == 0) {
      out.ledType = LedType::None;
    } else {
      err = "board_io.led.type must be gpio, rgb or none";
      return false;
    }
    out.ledPin = out.ledType == LedType::None ? -1 : (led["pin"] | -1);
    if (out.ledType != LedType::None && out.ledPin < 0) {
      err = "board_io.led needs a pin";
      return false;
    }
    out.ledActiveLow = led["active_low"] | false;
  }

  out.metrics = root["metrics"];
  out.actuators = root["actuators"];
  out.inputs = root["inputs"];
  out.outputs = root["outputs"];
  return true;
}
