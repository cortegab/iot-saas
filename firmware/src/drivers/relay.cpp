// Relay modules and any on/off output.
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
    // briefly. The retained desired state replaces this once MQTT connects.
    write(bootOn);
    pinMode(pin_, OUTPUT);
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
  void write(bool on) { digitalWrite(pin_, (on != activeLow_) ? HIGH : LOW); }

  int pin_ = -1;
  bool activeLow_ = false;
};

}  // namespace

OutputDriver* makeRelay() { return new Relay(); }
