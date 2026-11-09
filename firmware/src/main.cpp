// Generic device firmware. Every board of a type runs this same build; what it
// reads and drives comes from the `cfg` partition the dashboard writes when it
// flashes (src/config.h). See firmware/README.md.
#include <Arduino.h>
#include <esp_task_wdt.h>

#include "board.h"  // DEFAULT_LED_* until the config is read
#include "config.h"
#include "diag.h"
#include "io.h"
#include "led.h"
#include "net.h"
#include "ota.h"
#include "pins.h"
#include "version.h"

namespace {

// The loop must come round within this, or the board restarts (reason
// TASK_WDT on the next boot). Generous: a TLS connect blocks for a few
// seconds (net.cpp caps its handshake at 15 s).
constexpr uint32_t LOOP_WATCHDOG_MS = 30000;

DeviceConfig config;
String fault;  // non-empty = the config can't be used: stay offline, say why

// Never guess: a board with a bad config drives nothing and joins nothing. It
// blinks fast and repeats the reason on serial until it's re-configured.
void faultLoop() {
  static unsigned long lastReportMs = 0;
  // A new version that can't use this config goes back to the previous one.
  otaLoop(false);
  ledLoop(millis());
  if (lastReportMs == 0 || millis() - lastReportMs >= 5000) {
    lastReportMs = millis();
    Serial.printf("[CONFIG] %s (firmware %s, %s)\n", fault.c_str(), FW_VERSION, BOARD_ID);
  }
  delay(20);
}

// Arduino's loop task feeds the task watchdog on every pass once
// enableLoopWDT() has added it; the timeout here replaces the core's 5 s.
void startLoopWatchdog() {
  esp_task_wdt_config_t wdt = {};
  wdt.timeout_ms = LOOP_WATCHDOG_MS;
  wdt.idle_core_mask = 1 << 0;  // keep watching core 0's idle task, as the core does
  wdt.trigger_panic = true;
  esp_task_wdt_reconfigure(&wdt);
  enableLoopWDT();
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[BOOT] iot-saas firmware %s (%s)\n", FW_VERSION, BOARD_ID);
  diagBegin();
  Serial.printf("[BOOT] last restart: %s; boot %lu\n", diagResetReasonText(), (unsigned long)diagBootCount());
  startLoopWatchdog();
  otaBegin();
  // The chip's LED until the config names the board's own, so a board with no
  // usable config still blinks its fault.
  ledBegin(DEFAULT_LED_TYPE, DEFAULT_LED_PIN, DEFAULT_LED_ACTIVE_LOW);

  if (!loadConfig(config, fault)) {
    ledSet(LedState::Fault);
    return;
  }
  ledBegin(config.ledType, config.ledPin, config.ledActiveLow);
  // Before the bindings claim theirs, so one on these pins fails with a reason.
  reservePin(config.resetPin, "the reset button");
  reservePin(config.ledPin, "the status LED");
  if (!ioBegin(config, fault)) {
    ledSet(LedState::Fault);
    return;
  }
  Serial.printf("[BOOT] device %s/%s%s%s\n", config.tenant, config.device, strlen(config.model) ? " on " : "",
                config.model);
  netBegin(config);
}

void loop() {
  if (fault.length() > 0) return faultLoop();
  ioPoll(millis());
  netLoop();
  ioWatchConnection(netState() == NetState::Connected, millis());
  otaLoop(netState() == NetState::Connected);
  switch (netState()) {
    case NetState::Provisioning:
      ledSet(LedState::Provisioning);
      break;
    case NetState::Connecting:
      ledSet(LedState::Connecting);
      break;
    case NetState::Connected:
      ledSet(LedState::Running);
      break;
  }
  // A TLS connect to the broker blocks for a second or two, so the
  // connecting pattern can pause mid-blink; that's fine for a status light.
  ledLoop(millis());
  delay(10);
}
