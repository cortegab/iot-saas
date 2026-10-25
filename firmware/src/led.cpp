#include "led.h"

#include <Arduino.h>
#include <driver/gpio.h>

#include "led_pattern.h"

namespace {

// An RGB status LED lights dim blue: bright enough to read, never glaring.
constexpr uint8_t RGB_ON_BLUE = 40;

LedState state = LedState::Running;
uint32_t stateSinceMs = 0;
bool lit = false;
LedType ledType = LedType::None;
int ledPin = -1;
bool ledActiveLow = false;

int level(bool on) { return (on != ledActiveLow) ? HIGH : LOW; }

void drive(bool on) {
  switch (ledType) {
    case LedType::Gpio:
      digitalWrite(ledPin, level(on));
      break;
    case LedType::Rgb:
      rgbLedWrite(ledPin, 0, 0, on ? RGB_ON_BLUE : 0);
      break;
    case LedType::None:
      break;
  }
}

void write(bool on) {
  if (on == lit) return;
  lit = on;
  drive(on);
}

}  // namespace

void ledBegin(LedType type, int pin, bool activeLow) {
  if (type == ledType && pin == ledPin && activeLow == ledActiveLow) return;
  // Let go of the previous LED (the chip's default) before taking this one.
  if (ledPin >= 0) {
    drive(false);
    if (ledType == LedType::Gpio && pin != ledPin) pinMode(ledPin, INPUT);
  }
  ledType = type;
  ledPin = pin;
  ledActiveLow = activeLow;
  lit = false;
  if (ledType == LedType::Gpio) {
    // Off first, then output: the same order as the relay driver, so the LED
    // doesn't light while the board boots (the C3's LED is active-low).
    gpio_set_level((gpio_num_t)ledPin, level(false));
    pinMode(ledPin, OUTPUT);
  }
  drive(false);
}

void ledSet(LedState next) {
  if (next == state) return;
  state = next;
  stateSinceMs = millis();  // each pattern starts from its beginning
}

void ledLoop(uint32_t nowMs) { write(ledPatternAt(state, nowMs - stateSinceMs)); }
