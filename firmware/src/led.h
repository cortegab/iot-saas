#pragma once

#include <stdint.h>

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

// Sets the pin up with the LED off (no flash at boot).
void ledBegin();
void ledSet(LedState state);
// Every loop: advances the current pattern. Non-blocking.
void ledLoop(uint32_t nowMs);
