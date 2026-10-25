// DS18B20 1-Wire temperature probes: up to 4 on one pin, as temp_1..temp_4 in
// address order. Conversions run in the background: request, then read once
// the resolution's conversion time has passed, so the loop never waits.
//
// Not on every chip: OneWire 2.3.8's direct GPIO access doesn't build for the
// ESP32-C6 (drivers.json "chips"; platformio.ini ignores the library there).
#ifdef IOD_DRIVER_DS18B20

#include <DallasTemperature.h>
#include <OneWire.h>

#include "driver.h"
#include "driver_math.h"

namespace {

constexpr int MAX_PROBES = 4;
constexpr uint32_t RESCAN_MS = 5000;

class Ds18b20 : public InputDriver {
 public:
  bool begin(JsonObjectConst binding, String& err) override {
    long resolution, interval;
    if (!claimPin(binding, "pin", PinUse::Bus, pin_, err)) return false;
    if (!intParam(binding, "resolution", 12, 9, 12, resolution, err)) return false;
    if (!intParam(binding, "interval_ms", 2000, 1000, 60000, interval, err)) return false;
    resolution_ = resolution;
    intervalMs_ = interval;
    convMs_ = ds18b20ConversionMs(resolution_) + 10;
    wire_ = new OneWire(pin_);
    sensors_ = new DallasTemperature(wire_);
    sensors_->begin();
    sensors_->setWaitForConversion(false);
    scan();
    return true;
  }

  void poll(uint32_t nowMs) override {
    if (converting_) {
      if (nowMs - requestedMs_ < convMs_) return;
      converting_ = false;
      for (int i = 0; i < MAX_PROBES; i++) {
        float t = i < count_ ? sensors_->getTempC(addrs_[i]) : DEVICE_DISCONNECTED_C;
        // -127 means the probe didn't answer: unknown, never a reading.
        temps_[i] = (t == DEVICE_DISCONNECTED_C || (t == 85.0f && firstRead_)) ? NAN : t;
      }
      firstRead_ = false;
      return;
    }
    if (nowMs - requestedMs_ < intervalMs_ && requestedMs_ != 0) return;
    // No probes (yet): look again every few seconds, so plugging one in works.
    if (count_ == 0) {
      if (nowMs - scannedMs_ < RESCAN_MS) return;
      scannedMs_ = nowMs;
      scan();
      if (count_ == 0) return;
    }
    sensors_->requestTemperatures();
    requestedMs_ = nowMs;
    converting_ = true;
  }

  float read(const char* channel) override {
    // temp_1..temp_4
    int i = channel[5] - '1';
    return i >= 0 && i < MAX_PROBES ? temps_[i] : NAN;
  }

  const char* const* channels() const override {
    static const char* const names[] = {"temp_1", "temp_2", "temp_3", "temp_4", nullptr};
    return names;
  }

 private:
  void scan() {
    count_ = 0;
    sensors_->begin();
    int found = sensors_->getDeviceCount();
    for (int i = 0; i < found && count_ < MAX_PROBES; i++) {
      if (sensors_->getAddress(addrs_[count_], i)) {
        sensors_->setResolution(addrs_[count_], resolution_);
        count_++;
      }
    }
    if (found > 0) Serial.printf("[DS18B20] %d probe(s) on GPIO %d\n", count_, pin_);
  }

  int pin_ = -1;
  uint8_t resolution_ = 12;
  uint32_t intervalMs_ = 2000, convMs_ = 760;
  OneWire* wire_ = nullptr;
  DallasTemperature* sensors_ = nullptr;
  DeviceAddress addrs_[MAX_PROBES];
  int count_ = 0;
  float temps_[MAX_PROBES] = {NAN, NAN, NAN, NAN};
  bool converting_ = false;
  // 85 °C is the power-on value, read before the first conversion finishes.
  bool firstRead_ = true;
  uint32_t requestedMs_ = 0, scannedMs_ = 0;
};

}  // namespace

InputDriver* makeDs18b20() { return new Ds18b20(); }

#endif  // IOD_DRIVER_DS18B20
