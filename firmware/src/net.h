#pragma once

#include "config.h"

// Wi-Fi (BLE provisioning, or typed-in for a bench test), MQTT and the status
// topic. Ported from the generated sketch: same topics, same Last-Will, same
// provisioning flow (docs/ble-provisioning.md).
void netBegin(const DeviceConfig& cfg);

// Every loop: the provisioning-reset button, MQTT (re)connects without
// blocking the loop for long, incoming messages, telemetry and status.
void netLoop();

// Where the board is in getting online, for the status LED.
enum class NetState { Provisioning, Connecting, Connected };
NetState netState();
