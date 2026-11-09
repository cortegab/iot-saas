#pragma once

#include <Arduino.h>

// What the board reports about itself in its status message (net.cpp), so
// the platform's Health can say why it misbehaves without a serial cable.

// Once at boot, before anything else: reads why the chip last restarted and
// counts this boot in NVS.
void diagBegin();

// Why the chip last restarted, as a short code: "power_on", "reset_pin",
// "software", "crash", "interrupt_wdt", "task_wdt", "other_wdt", "deep_sleep",
// "brownout", "sdio", "usb", "jtag", "unknown".
const char* diagResetReason();
// The same, in words, for the serial log.
const char* diagResetReasonText();

// Boots since the firmware was installed (kept in NVS; a full install wipes it).
uint32_t diagBootCount();

// Wi-Fi rejoins since boot (every connection after the first).
void diagNoteWifiConnected();
uint32_t diagWifiReconnects();
