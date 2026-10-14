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

// One line per driver. release.py reads these ids to check them against
// drivers.json, so keep the {"id", make...} shape.
const InputEntry INPUTS[] = {
    {"digital_in", makeDigitalIn},
    {"analog_in", makeAnalogIn},
    {"ds18b20", makeDs18b20},
    {"dht22", makeDht22},
    {"pulse_counter", makePulseCounter},
    {"hcsr04", makeHcsr04},
    {"mpu6050", makeMpu6050},
};
const OutputEntry OUTPUTS[] = {
    {"relay", makeRelay},
    {"pwm", makePwm},
    {"servo", makeServo},
};

}  // namespace

InputDriver* makeInputDriver(const char* id) {
  for (const InputEntry& e : INPUTS)
    if (strcmp(e.id, id) == 0) return e.make();
  return nullptr;
}

OutputDriver* makeOutputDriver(const char* id) {
  for (const OutputEntry& e : OUTPUTS)
    if (strcmp(e.id, id) == 0) return e.make();
  return nullptr;
}
