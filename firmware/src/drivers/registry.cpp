#include "registry.h"

InputDriver* makeDigitalIn();
InputDriver* makeAnalogIn();
OutputDriver* makeRelay();

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
};
const OutputEntry OUTPUTS[] = {
    {"relay", makeRelay},
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
