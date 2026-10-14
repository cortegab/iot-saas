#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "../pins.h"

// Every sensor and actuator the firmware supports is a driver behind one of
// these two interfaces, configured by a binding from the `cfg` partition:
//   {"driver": "<id>", "pins": {role: gpio}, "params": {...}, "channels": {channel: key}}
// Adding one: docs/firmware/drivers.md.

class InputDriver {
 public:
  virtual ~InputDriver() = default;
  // Validates the binding's pins and params and sets up the hardware. Never
  // blocks for long; returns false with `err` set on a bad binding.
  virtual bool begin(JsonObjectConst binding, String& err) = 0;
  // Called every loop. Non-blocking: time things with nowMs.
  virtual void poll(uint32_t nowMs) {}
  // The latest reading for a channel, or NAN when there isn't one (not ready,
  // sensor missing, read failed). NAN is "unknown": it's never published.
  virtual float read(const char* channel) = 0;
  // The channel names this driver offers, ending with nullptr.
  virtual const char* const* channels() const = 0;
};

class OutputDriver {
 public:
  virtual ~OutputDriver() = default;
  // Like InputDriver::begin, and puts the output in its safe boot state
  // before Wi-Fi comes up.
  virtual bool begin(JsonObjectConst binding, String& err) = 0;
  // Applies a command's or desired state's value. False with `err` set if the
  // value doesn't make sense for this output.
  virtual bool apply(JsonVariantConst value, String& err) = 0;
};

// ---- param helpers: a missing param takes its default; a present but wrong
// one is an error, never silently replaced.

inline bool intParam(JsonObjectConst binding, const char* key, long def, long min, long max, long& out, String& err) {
  JsonVariantConst v = binding["params"][key];
  if (v.isNull()) {
    out = def;
    return true;
  }
  if (!v.is<long>() || v.as<long>() < min || v.as<long>() > max) {
    err = String(binding["driver"] | "?") + ": " + key + " must be a whole number from " + min + " to " + max;
    return false;
  }
  out = v.as<long>();
  return true;
}

inline bool floatParam(JsonObjectConst binding, const char* key, float def, float& out, String& err) {
  JsonVariantConst v = binding["params"][key];
  if (v.isNull()) {
    out = def;
    return true;
  }
  if (!v.is<float>()) {
    err = String(binding["driver"] | "?") + ": " + key + " must be a number";
    return false;
  }
  out = v.as<float>();
  return true;
}

inline bool boolParam(JsonObjectConst binding, const char* key, bool def, bool& out, String& err) {
  JsonVariantConst v = binding["params"][key];
  if (v.isNull()) {
    out = def;
    return true;
  }
  if (!v.is<bool>()) {
    err = String(binding["driver"] | "?") + ": " + key + " must be true or false";
    return false;
  }
  out = v.as<bool>();
  return true;
}

// A command value read as on/off: true/false, a number (non-zero = on), or the
// strings "on"/"off", "true"/"false", "1"/"0" in any case.
inline bool truthy(JsonVariantConst value, bool& on) {
  if (value.is<bool>()) {
    on = value.as<bool>();
    return true;
  }
  if (value.is<float>()) {
    on = value.as<float>() != 0;
    return true;
  }
  if (value.is<const char*>()) {
    const char* s = value.as<const char*>();
    if (!strcasecmp(s, "on") || !strcasecmp(s, "true") || !strcmp(s, "1")) return on = true, true;
    if (!strcasecmp(s, "off") || !strcasecmp(s, "false") || !strcmp(s, "0")) return on = false, true;
  }
  return false;
}
