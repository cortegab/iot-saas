#include "pins.h"

#include <map>

namespace {

// The GPIOs bindings may use: BOARDS' input and output pools in
// frontend/src/lib/firmware-sketch.ts, plus ADC1 and the ESP32's input-only
// pins. Never strapping, flash, USB or the reset button's pin. One block per
// chip; release.py reads them and checks CHIP_PINS in
// frontend/src/lib/hardware/board-pins.ts against them. -1 = none.
#if CONFIG_IDF_TARGET_ESP32C3
const int8_t USABLE[] = {0, 1, 3, 4, 5, 6, 7, 10, 20, 21};
const int8_t ADC1[] = {0, 1, 3, 4};
const int8_t INPUT_ONLY[] = {-1};
#elif CONFIG_IDF_TARGET_ESP32
const int8_t USABLE[] = {4, 13, 14, 16, 17, 18, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39};
const int8_t ADC1[] = {32, 33, 34, 35, 36, 39};
const int8_t INPUT_ONLY[] = {34, 35, 36, 39};
#elif CONFIG_IDF_TARGET_ESP32S3
// Left out: strapping 0, 3, 45, 46; USB 19, 20; flash and octal PSRAM 26–37;
// the USB-UART bridge 43, 44. 38 and 48 are each a DevKitC-1 revision's RGB
// LED: the model that has its LED there doesn't offer it (boards.json).
const int8_t USABLE[] = {1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 41, 42, 47, 48};
const int8_t ADC1[] = {1, 2, 4, 5, 6, 7, 8, 9, 10};
const int8_t INPUT_ONLY[] = {-1};
#elif CONFIG_IDF_TARGET_ESP32C6
// Left out: strapping 4, 5, 8 (the RGB LED), 9 (BOOT), 15; USB 12, 13; the
// USB-UART bridge 16, 17; flash 24-30.
const int8_t USABLE[] = {0, 1, 2, 3, 6, 7, 10, 11, 14, 18, 19, 20, 21, 22, 23};
const int8_t ADC1[] = {0, 1, 2, 3, 6};
const int8_t INPUT_ONLY[] = {-1};
#elif CONFIG_IDF_TARGET_ESP32S2
// Left out: strapping 0, 45, 46; USB 19, 20; flash and PSRAM 26-32; 15 (the
// Lolin S2 Mini's LED).
const int8_t USABLE[] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 21, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42};
const int8_t ADC1[] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
const int8_t INPUT_ONLY[] = {-1};
#else
#error "No pin rules for this chip in src/pins.cpp"
#endif

template <size_t N>
bool contains(const int8_t (&list)[N], int pin) {
  for (int8_t p : list)
    if (p == pin) return true;
  return false;
}

std::map<int, String> owners;

}  // namespace

bool hasInternalPull(int pin) { return !contains(INPUT_ONLY, pin); }

void reservePin(int pin, const char* owner) {
  if (pin >= 0) owners[pin] = owner;
}

bool claimRawPin(int pin, PinUse use, const char* owner, String& err) {
  String where = String("GPIO ") + pin + " (" + owner + ")";
  if (!contains(USABLE, pin)) {
    err = where + " isn't a pin this board hands out";
    return false;
  }
  if ((use == PinUse::Output || use == PinUse::Bus) && contains(INPUT_ONLY, pin)) {
    err = where + " is input-only";
    return false;
  }
  if (use == PinUse::Analog && !contains(ADC1, pin)) {
    err = where + " can't read analog while Wi-Fi is on (ADC1 pins only)";
    return false;
  }
  auto taken = owners.find(pin);
  if (taken != owners.end()) {
    err = where + " is already used by " + taken->second;
    return false;
  }
  owners[pin] = owner;
  return true;
}

bool claimPin(JsonObjectConst binding, const char* role, PinUse use, int& pin, String& err) {
  JsonVariantConst value = binding["pins"][role];
  String owner = String(binding["driver"] | "?") + "." + role;
  if (!value.is<int>()) {
    err = owner + ": no pin set";
    return false;
  }
  pin = value.as<int>();
  return claimRawPin(pin, use, owner.c_str(), err);
}
