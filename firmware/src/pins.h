#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

// What a binding needs a GPIO for. The dashboard checks the same rules
// (frontend/src/lib/hardware/validate.ts) before it writes a config; these
// checks are the backstop for a config that skipped it.
enum class PinUse {
  Input,   // digital in; input-only pins allowed
  Output,  // needs an output-capable pin
  Analog,  // ADC1 only: ADC2 doesn't work while Wi-Fi is on
  Bus,     // I2C / 1-Wire: needs input and output
};

// Takes binding["pins"][role] for this binding. Fails if the pin is missing,
// not one this board hands out, wrong for `use`, or already taken.
bool claimPin(JsonObjectConst binding, const char* role, PinUse use, int& pin, String& err);

// Same rules for a pin that isn't in a binding (the I2C bus).
bool claimRawPin(int pin, PinUse use, const char* owner, String& err);

// Whether a pin has internal pull resistors (the ESP32's 34–39 don't).
bool hasInternalPull(int pin);
