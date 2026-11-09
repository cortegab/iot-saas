#pragma once

#include <Arduino.h>

// Sensor faults. A driver reports when a part stops answering and when it
// answers again; only the changes are logged ("[SENSOR] mpu6050@0x68: not
// answering" ... "answering again after 37 s"), so a flaky wire shows up in the
// serial log without flooding it. The current faults also go into the status
// message (net.cpp), so they show on the device's Health without a cable.
//
// `who` names the part and where it is ("mpu6050@0x68", "dht22@GPIO4"); it's
// copied, so a temporary string is fine.

void sensorFault(const char* who, const char* what);
void sensorOk(const char* who);

// The current faults, oldest first: "mpu6050@0x68: not answering".
size_t sensorFaultCount();
String sensorFaultText(size_t i);

// Goes up whenever the list changes, so the status message can go out at once.
uint32_t sensorFaultsVersion();
