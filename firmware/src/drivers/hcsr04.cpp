// HC-SR04 ultrasonic distance: a 10 µs trigger pulse, then the echo pin stays
// high for the sound's round trip. The echo is timed by a pin interrupt, so
// the loop never waits for it. ECHO is a 5 V signal: wire it through a
// divider (drivers.json wiring notes).
#include "driver.h"
#include "driver_math.h"

namespace {

// Past ~25 ms the sensor gave up (nothing within ~4 m).
constexpr uint32_t ECHO_TIMEOUT_US = 30000;

class Hcsr04 : public InputDriver {
 public:
  bool begin(JsonObjectConst binding, String& err) override {
    long interval;
    if (!claimPin(binding, "trig", PinUse::Output, trig_, err)) return false;
    if (!claimPin(binding, "echo", PinUse::Input, echo_, err)) return false;
    if (!intParam(binding, "interval_ms", 500, 60, 5000, interval, err)) return false;
    if (!floatParam(binding, "max_cm", 400, maxCm_, err)) return false;
    intervalMs_ = interval;
    digitalWrite(trig_, LOW);
    pinMode(trig_, OUTPUT);
    pinMode(echo_, INPUT);
    attachInterruptArg(echo_, onEcho, this, CHANGE);
    return true;
  }

  void poll(uint32_t nowMs) override {
    if (waiting_) {
      if (done_) {
        float cm = echoUsToCm(echoUs_);
        distance_ = (cm < 2 || cm > maxCm_) ? NAN : cm;
        waiting_ = false;
      } else if (micros() - triggeredUs_ > ECHO_TIMEOUT_US) {
        distance_ = NAN;  // no echo: nothing in range, or not wired
        waiting_ = false;
      }
      return;
    }
    if (nowMs - lastMs_ < intervalMs_) return;
    lastMs_ = nowMs;
    done_ = false;
    rising_ = 0;
    waiting_ = true;
    triggeredUs_ = micros();
    digitalWrite(trig_, HIGH);
    delayMicroseconds(10);
    digitalWrite(trig_, LOW);
  }

  float read(const char*) override { return distance_; }

  const char* const* channels() const override {
    static const char* const names[] = {"distance_cm", nullptr};
    return names;
  }

 private:
  static void IRAM_ATTR onEcho(void* arg) {
    auto* self = static_cast<Hcsr04*>(arg);
    uint32_t now = micros();
    if (digitalRead(self->echo_) == HIGH) {
      self->rising_ = now;
    } else if (self->rising_ != 0 && !self->done_) {
      self->echoUs_ = now - self->rising_;
      self->done_ = true;
    }
  }

  int trig_ = -1, echo_ = -1;
  uint32_t intervalMs_ = 500, lastMs_ = 0;
  float maxCm_ = 400;
  float distance_ = NAN;
  bool waiting_ = false;
  uint32_t triggeredUs_ = 0;
  volatile uint32_t rising_ = 0, echoUs_ = 0;
  volatile bool done_ = false;
};

}  // namespace

InputDriver* makeHcsr04() { return new Hcsr04(); }
