#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

// Over-the-air updates (1.0.0, docs/firmware/ota.md). The platform publishes
// {tenant}/{device}/ota:
//   {"version": "1.0.1", "url": "https://.../firmware.bin", "size": 1386543,
//    "sha256": "<hex>", "signature": "<base64 DER ECDSA P-256 over the SHA-256>",
//    "command_id": "<uuid>"}
// The board downloads it into the other app slot, checks size, SHA-256 and
// signature (against the public keys built in from ota_keys/), and restarts
// into it. The new version counts as good only once it reaches MQTT; if it
// doesn't within 2 minutes, the bootloader goes back to the previous one.
// Progress goes out in the status message's "ota" object (net.cpp).

// At boot: notes whether this is a new version on probation, or whether the
// last update was rolled back.
void otaBegin();

// Every loop: marks a version on probation good once MQTT is up, or rolls
// back after 2 minutes without it.
void otaLoop(bool mqttConnected);

// An update request arrived (net.cpp's MQTT callback). Only queued here: the
// download runs from otaRun(), outside the callback.
void otaRequest(const uint8_t* payload, unsigned int length);

// A queued update: true after net.cpp has said "downloading" in a status message.
bool otaPending();

// Runs the queued update. Blocks for the download (feeding the watchdog);
// restarts the board on success, so it returns only on failure.
void otaRun();

// The status message's "ota" object, if there's anything to say. Goes up
// whenever it changes, so the status can go out at once.
bool otaReport(JsonObject out);
uint32_t otaReportVersion();
