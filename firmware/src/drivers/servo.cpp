// A hobby servo (SG90 and the like): the command is an angle. 50 Hz LEDC at
// 14 bits, our own code, so no servo library.
#include "driver.h"
#include "driver_math.h"

namespace {

constexpr uint8_t BITS = 14;

class Servo : public OutputDriver {
 public:
  bool begin(JsonObjectConst binding, String& err) override {
    if (!claimPin(binding, "pin", PinUse::Output, pin_, err)) return false;
    if (!floatParam(binding, "min_us", 500, minUs_, err)) return false;
    if (!floatParam(binding, "max_us", 2500, maxUs_, err)) return false;
    if (!floatParam(binding, "min_angle", 0, minAngle_, err)) return false;
    if (!floatParam(binding, "max_angle", 180, maxAngle_, err)) return false;
    float boot;
    if (!floatParam(binding, "boot_angle", 90, boot, err)) return false;
    if (minUs_ < 200 || maxUs_ > 3000 || minUs_ >= maxUs_) {
      err = "servo: pulse widths must be 200-3000 us, min below max";
      return false;
    }
    if (!ledcAttach(pin_, 50, BITS)) {
      err = String("servo: can't drive GPIO ") + pin_;
      return false;
    }
    write(boot);
    return true;
  }

  bool apply(JsonVariantConst value, String& err) override {
    float angle;
    if (!numeric(value, angle) || value.is<bool>()) {
      err = "servo: expected an angle";
      return false;
    }
    write(angle);
    return true;
  }

 private:
  void write(float angle) {
    ledcWrite(pin_, servoDuty(servoPulseUs(angle, minAngle_, maxAngle_, minUs_, maxUs_), BITS));
  }

  int pin_ = -1;
  float minUs_ = 500, maxUs_ = 2500, minAngle_ = 0, maxAngle_ = 180;
};

}  // namespace

OutputDriver* makeServo() { return new Servo(); }
