// Contacts, buttons, float switches, PIR: one GPIO read as 1/0.
#include "driver.h"

namespace {

class DigitalIn : public InputDriver {
 public:
  bool begin(JsonObjectConst binding, String& err) override {
    if (!claimPin(binding, "pin", PinUse::Input, pin_, err)) return false;
    long debounce;
    if (!boolParam(binding, "invert", false, invert_, err)) return false;
    if (!intParam(binding, "debounce_ms", 30, 0, 1000, debounce, err)) return false;
    debounceMs_ = debounce;

    const char* pull = binding["params"]["pull"] | "up";
    if (strcmp(pull, "none") != 0 && !hasInternalPull(pin_)) {
      err = String("digital_in: GPIO ") + pin_ + " has no internal pull resistor; set pull to none and fit one";
      return false;
    }
    if (strcmp(pull, "up") == 0) {
      pinMode(pin_, INPUT_PULLUP);
    } else if (strcmp(pull, "down") == 0) {
      pinMode(pin_, INPUT_PULLDOWN);
    } else if (strcmp(pull, "none") == 0) {
      pinMode(pin_, INPUT);
    } else {
      err = "digital_in: pull must be up, down or none";
      return false;
    }
    return true;
  }

  // A mechanical switch bounces for a few ms: only accept a level that has held
  // for debounce_ms.
  void poll(uint32_t nowMs) override {
    int level = digitalRead(pin_);
    if (level != candidate_) {
      candidate_ = level;
      sinceMs_ = nowMs;
    }
    if (nowMs - sinceMs_ >= debounceMs_) stable_ = candidate_;
  }

  float read(const char*) override {
    if (stable_ < 0) return NAN;
    return ((stable_ == HIGH) != invert_) ? 1.0f : 0.0f;
  }

  const char* const* channels() const override {
    static const char* const names[] = {"value", nullptr};
    return names;
  }

 private:
  int pin_ = -1;
  bool invert_ = false;
  uint32_t debounceMs_ = 30;
  int candidate_ = -1;
  int stable_ = -1;
  uint32_t sinceMs_ = 0;
};

}  // namespace

InputDriver* makeDigitalIn() { return new DigitalIn(); }
