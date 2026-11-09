#include "health.h"

namespace {

// More than this many faulty parts at once is already a "go look" situation;
// the rest are still logged, just not listed.
constexpr size_t MAX_FAULTS = 8;

struct Fault {
  char who[24];
  char what[40];
  uint32_t sinceMs;
};

Fault faults[MAX_FAULTS];
size_t count = 0;

int find(const char* who) {
  for (size_t i = 0; i < count; i++)
    if (strncmp(faults[i].who, who, sizeof(faults[i].who) - 1) == 0) return (int)i;
  return -1;
}

}  // namespace

void sensorFault(const char* who, const char* what) {
  int i = find(who);
  if (i >= 0) {
    if (strncmp(faults[i].what, what, sizeof(faults[i].what) - 1) == 0) return;  // no change
    Serial.printf("[SENSOR] %s: %s\n", who, what);
  } else {
    Serial.printf("[SENSOR] %s: %s\n", who, what);
    if (count == MAX_FAULTS) return;
    i = (int)count++;
    strlcpy(faults[i].who, who, sizeof(faults[i].who));
    faults[i].sinceMs = millis();
  }
  strlcpy(faults[i].what, what, sizeof(faults[i].what));
}

void sensorOk(const char* who) {
  int i = find(who);
  if (i < 0) return;
  Serial.printf("[SENSOR] %s: answering again after %lu s\n", who, (unsigned long)((millis() - faults[i].sinceMs) / 1000));
  for (size_t j = (size_t)i; j + 1 < count; j++) faults[j] = faults[j + 1];
  count--;
}

size_t sensorFaultCount() { return count; }

String sensorFaultText(size_t i) {
  if (i >= count) return String();
  return String(faults[i].who) + ": " + faults[i].what;
}
