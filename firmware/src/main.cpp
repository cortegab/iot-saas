// Generic device firmware. Every board of a type runs this same build; what it
// reads and drives comes from the `cfg` partition the dashboard writes when it
// flashes (src/config.h). See firmware/README.md.
#include <Arduino.h>

#include "board.h"
#include "config.h"
#include "io.h"
#include "net.h"
#include "version.h"

namespace {

DeviceConfig config;
String fault;  // non-empty = the config can't be used: stay offline, say why

void setLed(bool on) { digitalWrite(LED_PIN, (on != LED_ACTIVE_LOW) ? HIGH : LOW); }

// Never guess: a board with a bad config drives nothing and joins nothing. It
// blinks fast and repeats the reason on serial until it's re-configured.
void faultLoop() {
  static unsigned long lastReportMs = 0;
  setLed((millis() / 150) % 2 == 0);
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

  if (!loadConfig(config, fault) || !ioBegin(config, fault)) {
    pinMode(LED_PIN, OUTPUT);
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
  delay(10);
}
