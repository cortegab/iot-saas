// Generic device firmware. Every board of a type runs this same build; what it
// reads and drives comes from the `cfg` partition the dashboard writes when it
// flashes (src/config.h). See firmware/README.md.
#include <Arduino.h>

#include "board.h"  // DEFAULT_LED_* until the config is read
#include "config.h"
#include "io.h"
#include "led.h"
#include "net.h"
#include "pins.h"
#include "version.h"

namespace {

DeviceConfig config;
String fault;  // non-empty = the config can't be used: stay offline, say why

// Never guess: a board with a bad config drives nothing and joins nothing. It
// blinks fast and repeats the reason on serial until it's re-configured.
void faultLoop() {
  static unsigned long lastReportMs = 0;
  ledLoop(millis());
  if (lastReportMs == 0 || millis() - lastReportMs >= 5000) {
    lastReportMs = millis();
    Serial.printf("[CONFIG] %s (firmware %s, %s)\n", fault.c_str(), FW_VERSION, BOARD_ID);
  }
  delay(20);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[BOOT] iot-saas firmware %s (%s)\n", FW_VERSION, BOARD_ID);
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
