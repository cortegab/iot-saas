#include "led.h"

#include <Arduino.h>
#include <driver/gpio.h>

#include "board.h"
#include "led_pattern.h"

namespace {

LedState state = LedState::Running;
uint32_t stateSinceMs = 0;
bool lit = false;

int level(bool on) { return (on != LED_ACTIVE_LOW) ? HIGH : LOW; }

void write(bool on) {
  if (on == lit) return;
  lit = on;
  digitalWrite(LED_PIN, level(on));
}

}  // namespace

void ledBegin() {
  // Off first, then output: the same order as the relay driver, so the LED
  // doesn't light while the board boots (the C3's LED is active-low).
  gpio_set_level((gpio_num_t)LED_PIN, level(false));
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, level(false));
}

void ledSet(LedState next) {
  if (next == state) return;
  state = next;
  stateSinceMs = millis();  // each pattern starts from its beginning
}

void ledLoop(uint32_t nowMs) { write(ledPatternAt(state, nowMs - stateSinceMs)); }
