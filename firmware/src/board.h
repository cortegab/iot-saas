#pragma once

#include <Arduino.h>

// What differs per board. Mirrors BOARDS in frontend/src/lib/firmware-sketch.ts:
// keep the reset button and the GPIO pools in step with it.
#if CONFIG_IDF_TARGET_ESP32C3
#define BOARD_ID "esp32c3"
// The BOOT button: hold it 5 s while running to provision again.
#define RESET_PIN 9
// The Super Mini's blue LED, wired to 3V3: LOW lights it.
#define LED_PIN 8
#define LED_ACTIVE_LOW true
#define BLE_HANDLER NETWORK_PROV_SCHEME_HANDLER_FREE_BLE
#else
#define BOARD_ID "esp32"
// A button between GPIO 19 and GND: on the header of both the 30- and 38-pin
// DevKit (GPIO 0, the BOOT button, isn't on the 30-pin header).
#define RESET_PIN 19
#define LED_PIN 2
#define LED_ACTIVE_LOW false
#define BLE_HANDLER NETWORK_PROV_SCHEME_HANDLER_FREE_BTDM
#endif
