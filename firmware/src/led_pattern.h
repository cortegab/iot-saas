#pragma once

#include <stdint.h>

#include "led.h"

// Whether the LED is lit `t` ms into a state's pattern (see led.h). Pure, so
// it's host-tested (test/test_led_pattern).
inline bool ledPatternAt(LedState state, uint32_t t) {
  switch (state) {
    case LedState::Fault:
      return (t / 150) % 2 == 0;
    case LedState::Provisioning:
      return (t / 1000) % 2 == 0;
    case LedState::Connecting: {
      uint32_t phase = t % 1000;  // on 100, off 100, on 100, off 700
      return phase < 100 || (phase >= 200 && phase < 300);
    }
    case LedState::Running:
    default:
      return false;
  }
}
