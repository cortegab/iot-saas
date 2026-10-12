#pragma once

#include <PubSubClient.h>

#include "config.h"

// The device's inputs and outputs, built from the config's bindings, and the
// telemetry/command side of the device contract (CLAUDE.md §4) on top of them.

// Builds the drivers (outputs go to their safe boot state here, before Wi-Fi)
// and the metric/actuator tables. False with `err` on a bad binding.
bool ioBegin(const DeviceConfig& cfg, String& err);

// Every loop: lets each input driver sample.
void ioPoll(uint32_t nowMs);

// After (re)connecting: the retained config and each actuator's cmd/state.
void ioSubscribe(PubSubClient& mqtt);

// Publishes the metrics due now, per their publish profile.
void ioPublishMetrics(PubSubClient& mqtt);

// Routes an incoming message (config, cmd, state).
void ioHandleMessage(PubSubClient& mqtt, const char* topic, const uint8_t* payload, unsigned int length);
