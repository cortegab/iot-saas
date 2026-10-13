// Relay modules and any on/off output.
#include <driver/gpio.h>

#include "driver.h"

namespace {

class Relay : public OutputDriver {
 public:
  bool begin(JsonObjectConst binding, String& err) override {
    bool bootOn;
    if (!claimPin(binding, "pin", PinUse::Output, pin_, err)) return false;
    if (!boolParam(binding, "active_low", false, activeLow_, err)) return false;
    if (!boolParam(binding, "boot_state", false, bootOn, err)) return false;
    // Level first, then mode, so the pin never drives the wrong level, even
    // briefly: pinMode(OUTPUT) alone comes up LOW, which is "on" for an
    // active-low relay. digitalWrite() refuses a pin that isn't a GPIO output
    // yet (Arduino core 3.x), so the level is latched with ESP-IDF's
    // gpio_set_level, which works in any mode and which pinMode leaves alone.
    // The retained desired state replaces this once MQTT connects.
    gpio_set_level((gpio_num_t)pin_, level(bootOn));
    pinMode(pin_, OUTPUT);
    write(bootOn);
    return true;
  }

  bool apply(JsonVariantConst value, String& err) override {
    bool on;
    if (!truthy(value, on)) {
      err = "relay: expected on/off";
      return false;
    }
    write(on);
    return true;
  }

 private:
  int level(bool on) const { return (on != activeLow_) ? HIGH : LOW; }
  void write(bool on) { digitalWrite(pin_, level(on)); }

  int pin_ = -1;
  bool activeLow_ = false;
};

}  // namespace

OutputDriver* makeRelay() { return new Relay(); }
