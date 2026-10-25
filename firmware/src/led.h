#pragma once

#include <stdint.h>

#include "led_type.h"

// The board's built-in LED, reserved for the firmware's own status (never
// offered for wiring: firmware/boards.json keeps it out of every model's pins).
// One pattern per state, so a board's state reads without a serial monitor:
//
//   Fault         fast blink, 150 ms on / 150 ms off: the config is missing or invalid
//   Provisioning  slow blink, 1 s on / 1 s off: waiting for Wi-Fi from the phone app
//   Connecting    double blink every second: joining Wi-Fi or the MQTT broker
//   Running       off: connected and working
//
// Documented for people in firmware/README.md ("Status LED"); keep the two in step.
enum class LedState : uint8_t { Running, Provisioning, Connecting, Fault };

// Sets the LED up, off (no flash at boot). Called at boot with the chip's
// defaults, so a bad config can still blink, then again with the board
// model's LED from the config; a different pin is let go first.
void ledBegin(LedType type, int pin, bool activeLow);
void ledSet(LedState state);
// Every loop: advances the current pattern. Non-blocking.
void ledLoop(uint32_t nowMs);
