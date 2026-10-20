#include "registry.h"

InputDriver* makeDigitalIn();
InputDriver* makeAnalogIn();
InputDriver* makeDs18b20();
InputDriver* makeDht22();
InputDriver* makePulseCounter();
InputDriver* makeHcsr04();
InputDriver* makeMpu6050();
OutputDriver* makeRelay();
OutputDriver* makePwm();
OutputDriver* makeServo();

namespace {

struct InputEntry {
  const char* id;
  InputDriver* (*make)();
};
struct OutputEntry {
  const char* id;
  OutputDriver* (*make)();
};

// One entry per driver, each behind the IOD_DRIVER_<ID> that driver_flags.py
// defines when this chip's build carries it (drivers.json "chips"). release.py
// reads these ids to check them against drivers.json, so keep the
// `#ifdef IOD_DRIVER_X` / {"x", make...} shape. A driver that can't even
// compile on some chip also wraps its own .cpp in its #ifdef.
const InputEntry INPUTS[] = {
#ifdef IOD_DRIVER_DIGITAL_IN
    {"digital_in", makeDigitalIn},
#endif
#ifdef IOD_DRIVER_ANALOG_IN
    {"analog_in", makeAnalogIn},
#endif
#ifdef IOD_DRIVER_DS18B20
    {"ds18b20", makeDs18b20},
#endif
#ifdef IOD_DRIVER_DHT22
    {"dht22", makeDht22},
#endif
#ifdef IOD_DRIVER_PULSE_COUNTER
    {"pulse_counter", makePulseCounter},
#endif
#ifdef IOD_DRIVER_HCSR04
    {"hcsr04", makeHcsr04},
#endif
#ifdef IOD_DRIVER_MPU6050
    {"mpu6050", makeMpu6050},
#endif
    {nullptr, nullptr},
};
const OutputEntry OUTPUTS[] = {
#ifdef IOD_DRIVER_RELAY
    {"relay", makeRelay},
#endif
#ifdef IOD_DRIVER_PWM
    {"pwm", makePwm},
#endif
#ifdef IOD_DRIVER_SERVO
    {"servo", makeServo},
#endif
    {nullptr, nullptr},
};

}  // namespace

InputDriver* makeInputDriver(const char* id) {
  for (const InputEntry& e : INPUTS)
    if (e.id != nullptr && strcmp(e.id, id) == 0) return e.make();
  return nullptr;
}

OutputDriver* makeOutputDriver(const char* id) {
  for (const OutputEntry& e : OUTPUTS)
    if (e.id != nullptr && strcmp(e.id, id) == 0) return e.make();
  return nullptr;
}
