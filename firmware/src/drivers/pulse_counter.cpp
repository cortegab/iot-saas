// Pulses on a pin: flow meters, energy meters' pulse outputs, anemometers,
// rain gauges. Counted by a pin interrupt, which works on both chips (the C3
// has no PCNT peripheral), up to ~10 kHz. Channels: `total` (units since boot)
// and `rate_per_min` (units per minute over the last window).
#include "driver.h"
#include "driver_math.h"

namespace {

class PulseCounter : public InputDriver {
 public:
  bool begin(JsonObjectConst binding, String& err) override {
    long minGap, window;
    const char *edge, *pull;
    if (!claimPin(binding, "pin", PinUse::Input, pin_, err)) return false;
    if (!enumParam(binding, "edge", "falling", {"falling", "rising"}, edge, err)) return false;
    if (!enumParam(binding, "pull", "up", {"up", "down", "none"}, pull, err)) return false;
    if (!floatParam(binding, "pulses_per_unit", 1, perUnit_, err)) return false;
    if (!intParam(binding, "min_gap_us", 0, 0, 100000, minGap, err)) return false;
    if (!intParam(binding, "window_s", 5, 1, 60, window, err)) return false;
    if (perUnit_ <= 0) {
      err = "pulse_counter: pulses_per_unit must be above 0";
      return false;
    }
    if (strcmp(pull, "none") != 0 && !hasInternalPull(pin_)) {
      err = String("pulse_counter: GPIO ") + pin_ + " has no internal pull resistor; set pull to none and fit one";
      return false;
    }
    minGapUs_ = minGap;
    windowMs_ = window * 1000;
    pinMode(pin_, strcmp(pull, "up") == 0 ? INPUT_PULLUP : strcmp(pull, "down") == 0 ? INPUT_PULLDOWN : INPUT);
    attachInterruptArg(pin_, onPulse, this, strcmp(edge, "rising") == 0 ? RISING : FALLING);
    windowStartMs_ = millis();
    return true;
  }

  void poll(uint32_t nowMs) override {
    if (nowMs - windowStartMs_ < windowMs_) return;
    uint32_t pulses = snapshot();
    rate_ = pulseRatePerMin(pulses - windowStartPulses_, nowMs - windowStartMs_, perUnit_);
    windowStartPulses_ = pulses;
    windowStartMs_ = nowMs;
  }

  float read(const char* channel) override {
    if (strcmp(channel, "total") == 0) return snapshot() / perUnit_;
    if (strcmp(channel, "rate_per_min") == 0) return rate_;
    return NAN;
  }

  const char* const* channels() const override {
    static const char* const names[] = {"total", "rate_per_min", nullptr};
    return names;
  }

 private:
  static void IRAM_ATTR onPulse(void* arg) {
    auto* self = static_cast<PulseCounter*>(arg);
    uint32_t now = micros();
    // Ignore bounce / noise closer together than min_gap_us.
    if (self->minGapUs_ && now - self->lastUs_ < self->minGapUs_) return;
    self->lastUs_ = now;
    self->pulses_ = self->pulses_ + 1;  // only the ISR writes it
  }

  uint32_t snapshot() {
    noInterrupts();
    uint32_t p = pulses_;
    interrupts();
    return p;
  }

  int pin_ = -1;
  float perUnit_ = 1;
  uint32_t minGapUs_ = 0, windowMs_ = 5000;
  volatile uint32_t pulses_ = 0;
  volatile uint32_t lastUs_ = 0;
  uint32_t windowStartMs_ = 0, windowStartPulses_ = 0;
  float rate_ = NAN;  // unknown until the first window closes
};

}  // namespace

InputDriver* makePulseCounter() { return new PulseCounter(); }
