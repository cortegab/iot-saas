#include "diag.h"

#include <Preferences.h>
#include <esp_system.h>

namespace {

esp_reset_reason_t reason = ESP_RST_UNKNOWN;
uint32_t bootCount = 0;
uint32_t wifiConnects = 0;

}  // namespace

void diagBegin() {
  reason = esp_reset_reason();
  Preferences prefs;
  if (prefs.begin("iod", false)) {
    bootCount = prefs.getUInt("boots", 0) + 1;
    prefs.putUInt("boots", bootCount);
    prefs.end();
  }
}

const char* diagResetReason() {
  switch (reason) {
    case ESP_RST_POWERON: return "power_on";
    case ESP_RST_EXT: return "reset_pin";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "crash";
    case ESP_RST_INT_WDT: return "interrupt_wdt";
    case ESP_RST_TASK_WDT: return "task_wdt";
    case ESP_RST_WDT: return "other_wdt";
    case ESP_RST_DEEPSLEEP: return "deep_sleep";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_SDIO: return "sdio";
    case ESP_RST_USB: return "usb";
    case ESP_RST_JTAG: return "jtag";
    default: return "unknown";
  }
}

const char* diagResetReasonText() {
  switch (reason) {
    case ESP_RST_POWERON: return "power-on";
    case ESP_RST_EXT: return "reset pin";
    case ESP_RST_SW: return "restarted by the firmware";
    case ESP_RST_PANIC: return "crash";
    case ESP_RST_INT_WDT: return "interrupt watchdog";
    case ESP_RST_TASK_WDT: return "loop watchdog (the loop froze)";
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_DEEPSLEEP: return "deep sleep";
    case ESP_RST_BROWNOUT: return "brown-out (supply voltage dipped)";
    case ESP_RST_SDIO: return "SDIO";
    case ESP_RST_USB: return "USB";
    case ESP_RST_JTAG: return "JTAG";
    default: return "unknown";
  }
}

uint32_t diagBootCount() { return bootCount; }

void diagNoteWifiConnected() { wifiConnects++; }

uint32_t diagWifiReconnects() { return wifiConnects > 0 ? wifiConnects - 1 : 0; }
