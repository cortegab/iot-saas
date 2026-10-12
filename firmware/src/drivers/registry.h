#pragma once

#include "driver.h"

// Driver id → new instance; nullptr for an unknown id. The ids are the ones in
// firmware/drivers.json (release.py fails the build if the two disagree).
InputDriver* makeInputDriver(const char* id);
OutputDriver* makeOutputDriver(const char* id);
