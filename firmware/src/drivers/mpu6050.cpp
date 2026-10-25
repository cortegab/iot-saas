// MPU6050 (the GY-521 module) on the I2C bus: accelerometer + gyroscope.
// Our own register reads, no library. Channels:
//   tilt_x, tilt_y  (°, from gravity; meaningful while the board is still)
//   vibration_rms   (g, RMS of |a| - 1 g over window_ms)
//   temperature     (°C, the chip's own; runs warm)
//   accel_x/y/z (g), gyro_x/y/z (°/s): raw axes, for a `streaming` metric
// If the chip doesn't answer, every channel is unknown and it's retried every 5 s.
#include <Wire.h>

#include "driver.h"
#include "driver_math.h"

namespace {

constexpr uint8_t REG_CONFIG = 0x1A, REG_GYRO_CONFIG = 0x1B, REG_ACCEL_CONFIG = 0x1C;
constexpr uint8_t REG_ACCEL_XOUT_H = 0x3B, REG_PWR_MGMT_1 = 0x6B;
constexpr uint32_t RETRY_MS = 5000;

enum Ch { AX, AY, AZ, TEMP, GX, GY, GZ, TILT_X, TILT_Y, VIB, COUNT };
const char* const NAMES[] = {"accel_x", "accel_y", "accel_z", "temperature", "gyro_x", "gyro_y",
                             "gyro_z",  "tilt_x",  "tilt_y",  "vibration_rms", nullptr};

class Mpu6050 : public InputDriver {
 public:
  bool begin(JsonObjectConst binding, String& err) override {
    const char *address, *range;
    long hz, window;
    if (!i2cBusReady()) {
      err = "mpu6050: set the I2C bus pins (SDA/SCL) in the wiring";
      return false;
    }
    if (!enumParam(binding, "address", "0x68", {"0x68", "0x69"}, address, err)) return false;
    if (!enumParam(binding, "accel_range", "4", {"2", "4", "8", "16"}, range, err)) return false;
    if (!intParam(binding, "sample_hz", 50, 10, 200, hz, err)) return false;
    if (!intParam(binding, "window_ms", 1000, 200, 10000, window, err)) return false;
    addr_ = strtol(address, nullptr, 16);
    rangeG_ = atoi(range);
    periodMs_ = 1000 / hz;
    windowMs_ = window;
    for (float& v : values_) v = NAN;
    ok_ = init();  // a missing chip isn't a config error: it's retried
    if (!ok_) Serial.printf("[MPU6050] no answer at 0x%02X; retrying every 5 s\n", addr_);
    return true;
  }

  void poll(uint32_t nowMs) override {
    if (!ok_) {
      if (nowMs - triedMs_ < RETRY_MS) return;
      triedMs_ = nowMs;
      ok_ = init();
      if (!ok_) return;
      windowStartMs_ = nowMs;
    }
    if (nowMs - sampledMs_ >= periodMs_) {
      sampledMs_ = nowMs;
      sample();
    }
    if (ok_ && nowMs - windowStartMs_ >= windowMs_) {
      values_[VIB] = rms_.take();
      windowStartMs_ = nowMs;
    }
  }

  float read(const char* channel) override {
    for (int i = 0; i < COUNT; i++)
      if (strcmp(NAMES[i], channel) == 0) return values_[i];
    return NAN;
  }

  const char* const* channels() const override { return NAMES; }

 private:
  bool writeReg(uint8_t reg, uint8_t value) {
    Wire.beginTransmission(addr_);
    Wire.write(reg);
    Wire.write(value);
    return Wire.endTransmission() == 0;
  }

  bool init() {
    // Range bits: 0 = ±2 g, 1 = ±4, 2 = ±8, 3 = ±16.
    uint8_t rangeBits = rangeG_ == 2 ? 0 : rangeG_ == 4 ? 1 : rangeG_ == 8 ? 2 : 3;
    return writeReg(REG_PWR_MGMT_1, 0x01)            // wake, PLL clock
           && writeReg(REG_CONFIG, 0x03)             // ~44 Hz low-pass
           && writeReg(REG_GYRO_CONFIG, 0x08)        // ±500 °/s
           && writeReg(REG_ACCEL_CONFIG, rangeBits << 3);
  }

  void sample() {
    Wire.beginTransmission(addr_);
    Wire.write(REG_ACCEL_XOUT_H);
    if (Wire.endTransmission(false) != 0 || Wire.requestFrom(addr_, (uint8_t)14) != 14) {
      // Gone (unplugged, bus fault): unknown until it answers again.
      ok_ = false;
      triedMs_ = millis();
      for (float& v : values_) v = NAN;
      rms_.take();
      return;
    }
    int16_t raw[7];
    for (int16_t& r : raw) r = (int16_t)((Wire.read() << 8) | Wire.read());
    float ax = mpuAccelG(raw[0], rangeG_), ay = mpuAccelG(raw[1], rangeG_), az = mpuAccelG(raw[2], rangeG_);
    values_[AX] = ax;
    values_[AY] = ay;
    values_[AZ] = az;
    values_[TEMP] = mpuTempC(raw[3]);
    values_[GX] = mpuGyroDps(raw[4]);
    values_[GY] = mpuGyroDps(raw[5]);
    values_[GZ] = mpuGyroDps(raw[6]);
    values_[TILT_X] = tiltXDeg(ax, ay, az);
    values_[TILT_Y] = tiltYDeg(ax, ay, az);
    rms_.add(ax, ay, az);
  }

  uint8_t addr_ = 0x68;
  uint8_t rangeG_ = 4;
  uint32_t periodMs_ = 20, windowMs_ = 1000;
  bool ok_ = false;
  uint32_t triedMs_ = 0, sampledMs_ = 0, windowStartMs_ = 0;
  float values_[COUNT];
  RmsWindow rms_;
};

}  // namespace

InputDriver* makeMpu6050() { return new Mpu6050(); }
