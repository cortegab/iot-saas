// DHT22 / AM2302: temperature and humidity on one data pin. Our own reader,
// not a library: the common ESP32 DHT library is GPL-3.0 (THIRD_PARTY_NOTICES.md).
//
// The protocol: the host pulls the line low ≥1 ms; the sensor answers with
// 80 µs low + 80 µs high, then 40 bits, each a ~50 µs low followed by a high
// that lasts ~27 µs for 0 or ~70 µs for 1. Reading takes ~5 ms with
// interrupts held off (Wi-Fi tolerates that), at most every 2 s.
#include "driver.h"
#include "driver_math.h"

namespace {

constexpr uint32_t TIMEOUT = UINT32_MAX;
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

class Dht22 : public InputDriver {
 public:
  bool begin(JsonObjectConst binding, String& err) override {
    long interval;
    if (!claimPin(binding, "pin", PinUse::Bus, pin_, err)) return false;
    if (!intParam(binding, "interval_ms", 2500, 2000, 60000, interval, err)) return false;
    intervalMs_ = interval;
    pinMode(pin_, INPUT_PULLUP);
    lastMs_ = millis();  // the sensor needs ~1 s after power-up
    return true;
  }

  void poll(uint32_t nowMs) override {
    if (nowMs - lastMs_ < intervalMs_) return;
    lastMs_ = nowMs;
    float t, h;
    if (readSensor(t, h)) {
      temp_ = t;
      humidity_ = h;
      failures_ = 0;
    } else if (++failures_ >= 2) {
      // One glitch is common; two in a row means the sensor isn't answering.
      temp_ = humidity_ = NAN;
    }
  }

  float read(const char* channel) override {
    if (strcmp(channel, "temperature") == 0) return temp_;
    if (strcmp(channel, "humidity") == 0) return humidity_;
    return NAN;
  }

  const char* const* channels() const override {
    static const char* const names[] = {"temperature", "humidity", nullptr};
    return names;
  }

 private:
  // Microseconds the line stays at `level`, or TIMEOUT.
  uint32_t pulse(int level, uint32_t maxUs) {
    uint32_t start = micros();
    while (digitalRead(pin_) == level)
      if (micros() - start > maxUs) return TIMEOUT;
    return micros() - start;
  }

  bool readSensor(float& t, float& h) {
    uint8_t data[5] = {0, 0, 0, 0, 0};
    digitalWrite(pin_, LOW);
    pinMode(pin_, OUTPUT);
    delayMicroseconds(1100);
    bool ok = true;
    // Release the line, then time everything else with interrupts held off.
    // pinMode isn't safe inside the critical section, so the sensor's reply is
    // found by waiting for it rather than by a fixed delay.
    pinMode(pin_, INPUT_PULLUP);
    portENTER_CRITICAL(&mux);
    if (pulse(HIGH, 200) == TIMEOUT || pulse(LOW, 100) == TIMEOUT || pulse(HIGH, 100) == TIMEOUT) ok = false;
    for (int i = 0; ok && i < 40; i++) {
      uint32_t low = pulse(LOW, 100);
      uint32_t high = pulse(HIGH, 100);
      if (low == TIMEOUT || high == TIMEOUT) {
        ok = false;
        break;
      }
      data[i / 8] <<= 1;
      if (high > low) data[i / 8] |= 1;
    }
    portEXIT_CRITICAL(&mux);
    return ok && dht22Decode(data, t, h);
  }

  int pin_ = -1;
  uint32_t intervalMs_ = 2500, lastMs_ = 0;
  int failures_ = 0;
  float temp_ = NAN, humidity_ = NAN;
};

}  // namespace

InputDriver* makeDht22() { return new Dht22(); }
