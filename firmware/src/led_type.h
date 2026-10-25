#pragma once

#include <stdint.h>

// How a board's status LED is driven: a plain GPIO, an addressable RGB LED
// (WS2812-style, as on the S3 and C6 DevKits), or none at all. Its own header
// so host-side tests (led_pattern.h) don't pull in board.h's chip blocks.
enum class LedType : uint8_t { None, Gpio, Rgb };
