// A variable output: dimmers, fan speed, a MOSFET module, a passive buzzer, or
// a PWM-to-0-10 V module. The command value (in_min..in_max) sets the duty.
#include "driver.h"
#include "driver_math.h"

namespace {

class Pwm : public OutputDriver {
 public:
  bool begin(JsonObjectConst binding, String& err) override {
    long freq, bits;
    if (!claimPin(binding, "pin", PinUse::Output, pin_, err)) return false;
    if (!intParam(binding, "freq_hz", 1000, 1, 40000, freq, err)) return false;
    if (!intParam(binding, "resolution_bits", 10, 8, 14, bits, err)) return false;
    if (!floatParam(binding, "in_min", 0, inMin_, err)) return false;
    if (!floatParam(binding, "in_max", 100, inMax_, err)) return false;
    if (!boolParam(binding, "invert", false, invert_, err)) return false;
    float boot;
    if (!floatParam(binding, "boot_value", inMin_, boot, err)) return false;
    if (inMax_ == inMin_) {
      err = "pwm: in_min and in_max must differ";
      return false;
    }
    bits_ = bits;
    if (!ledcAttach(pin_, freq, bits_)) {
      err = String("pwm: can't run ") + freq + " Hz at " + bits + " bits on GPIO " + pin_ + " (try a lower frequency)";
      return false;
    }
    write(boot);
    return true;
  }

  bool apply(JsonVariantConst value, String& err) override {
    float v;
    if (!numeric(value, v)) {
      err = "pwm: expected a number";
      return false;
    }
    // On/off commands land on the ends of the range.
    if (value.is<bool>()) v = value.as<bool>() ? inMax_ : inMin_;
    write(v);
    return true;
  }

 private:
  void write(float v) { ledcWrite(pin_, pwmDuty(v, inMin_, inMax_, bits_, invert_)); }

  int pin_ = -1;
  uint8_t bits_ = 10;
  float inMin_ = 0, inMax_ = 100;
  bool invert_ = false;
};

}  // namespace

OutputDriver* makePwm() { return new Pwm(); }
