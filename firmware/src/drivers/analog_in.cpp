// 0–3.3 V sensors on an ADC1 pin: value = volts × scale + offset.
#include "driver.h"

namespace {

constexpr uint32_t SAMPLE_EVERY_MS = 100;

class AnalogIn : public InputDriver {
 public:
  bool begin(JsonObjectConst binding, String& err) override {
    long samples;
    if (!claimPin(binding, "pin", PinUse::Analog, pin_, err)) return false;
    if (!floatParam(binding, "scale", 1.0f, scale_, err)) return false;
    if (!floatParam(binding, "offset", 0.0f, offset_, err)) return false;
    if (!intParam(binding, "samples", 8, 1, 64, samples, err)) return false;
    samples_ = samples;
    analogSetPinAttenuation(pin_, ADC_11db);  // the full 0–3.3 V range
    return true;
  }

  // Averages a burst of samples every 100 ms; the ADC is noisy one-off.
  void poll(uint32_t nowMs) override {
    if (!isnan(value_) && nowMs - lastMs_ < SAMPLE_EVERY_MS) return;
    lastMs_ = nowMs;
    uint32_t sumMv = 0;
    for (int i = 0; i < samples_; i++) sumMv += analogReadMilliVolts(pin_);
    float volts = sumMv / (float)samples_ / 1000.0f;
    value_ = volts * scale_ + offset_;
  }

  float read(const char*) override { return value_; }

  const char* const* channels() const override {
    static const char* const names[] = {"value", nullptr};
    return names;
  }

 private:
  int pin_ = -1;
  float scale_ = 1.0f;
  float offset_ = 0.0f;
  int samples_ = 8;
  float value_ = NAN;
  uint32_t lastMs_ = 0;
};

}  // namespace

InputDriver* makeAnalogIn() { return new AnalogIn(); }
