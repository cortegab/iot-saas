#pragma once

#include <Arduino.h>

#include "led_type.h"

// What differs per chip, one block each; a target without a block doesn't
// build. The reset button and status LED here are only the chip's defaults:
// the board model's own (firmware/boards.json) arrive in the config's
// `board_io` and win. Mirrors CHIPS/BOARDS in frontend/src/lib/firmware-sketch.ts.
#if CONFIG_IDF_TARGET_ESP32C3
#define BOARD_ID "esp32c3"
// The BOOT button: hold it 5 s while running to provision again.
#define DEFAULT_RESET_PIN 9
// The Super Mini's blue LED, wired to 3V3: LOW lights it.
#define DEFAULT_LED_TYPE LedType::Gpio
#define DEFAULT_LED_PIN 8
#define DEFAULT_LED_ACTIVE_LOW true
// After provisioning, free the BLE controller's memory (scheme_ble.h).
#define BLE_HANDLER NETWORK_PROV_SCHEME_BLE_EVENT_HANDLER_FREE_BLE
#elif CONFIG_IDF_TARGET_ESP32
#define BOARD_ID "esp32"
// A button between GPIO 19 and GND: on the header of both the 30- and 38-pin
// DevKit (GPIO 0, the BOOT button, isn't on the 30-pin header).
#define DEFAULT_RESET_PIN 19
#define DEFAULT_LED_TYPE LedType::Gpio
#define DEFAULT_LED_PIN 2
#define DEFAULT_LED_ACTIVE_LOW false
// After provisioning, free the whole Bluetooth controller's memory (BLE and
// Classic), as WiFiProv did (scheme_ble.h).
#define BLE_HANDLER NETWORK_PROV_SCHEME_BLE_EVENT_HANDLER_FREE_BTDM
#else
#error "No block for this chip in src/board.h: add one here, in src/pins.cpp and in release.py's BOARDS."
#endif
