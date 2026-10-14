#pragma once

// The drivers' pure arithmetic: no Arduino, no hardware, so it's host-tested
// (test/test_driver_math). Each driver includes what it needs.

#include <math.h>
#include <stdint.h>

inline float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

// ---- pwm: a command value in [inMin, inMax] → an LEDC duty in [0, 2^bits - 1].
inline uint32_t pwmDuty(float value, float inMin, float inMax, uint8_t bits, bool invert) {
  const uint32_t top = (1u << bits) - 1;
  if (inMax == inMin) return 0;
  float frac = clampf((value - inMin) / (inMax - inMin), 0.0f, 1.0f);
  if (invert) frac = 1.0f - frac;
  return (uint32_t)lroundf(frac * top);
}

// ---- servo: angle → pulse width (µs) → duty at 50 Hz (a 20 000 µs period).
inline float servoPulseUs(float angle, float minAngle, float maxAngle, float minUs, float maxUs) {
  if (maxAngle == minAngle) return minUs;
  float a = clampf(angle, fminf(minAngle, maxAngle), fmaxf(minAngle, maxAngle));
  return minUs + (a - minAngle) * (maxUs - minUs) / (maxAngle - minAngle);
}
inline uint32_t servoDuty(float pulseUs, uint8_t bits) {
  const uint32_t top = (1u << bits) - 1;
  return (uint32_t)lroundf(clampf(pulseUs / 20000.0f, 0.0f, 1.0f) * top);
}

// ---- pulse counter: pulses counted over a window → units per minute.
inline float pulseRatePerMin(uint32_t pulses, uint32_t windowMs, float pulsesPerUnit) {
  if (windowMs == 0 || pulsesPerUnit <= 0) return NAN;
  return (pulses / pulsesPerUnit) * 60000.0f / windowMs;
}

// ---- hc-sr04: echo high time (µs) → distance (cm). Sound covers ~0.0343 cm/µs,
// out and back, so half of that.
inline float echoUsToCm(uint32_t echoUs) { return echoUs * 0.01715f; }

// ---- ds18b20: conversion time for a resolution (9–12 bits): 93.75 ms × 2^(bits-9).
inline uint32_t ds18b20ConversionMs(uint8_t bits) { return 750u >> (12 - bits); }

// ---- dht22: 5 bytes off the wire → °C and %RH. False on a bad checksum.
inline bool dht22Decode(const uint8_t data[5], float& tempC, float& humidity) {
  if ((uint8_t)(data[0] + data[1] + data[2] + data[3]) != data[4]) return false;
  humidity = ((data[0] << 8) | data[1]) / 10.0f;
  tempC = (((data[2] & 0x7F) << 8) | data[3]) / 10.0f;
  if (data[2] & 0x80) tempC = -tempC;
  return true;
}

// ---- mpu6050
// Raw accelerometer counts → g, for a full-scale range of ±2/4/8/16 g.
inline float mpuAccelG(int16_t raw, uint8_t rangeG) { return raw / (32768.0f / rangeG); }
// Raw gyro counts → °/s at ±500 °/s full scale (65.5 counts per °/s).
inline float mpuGyroDps(int16_t raw) { return raw / 65.5f; }
// Raw die temperature → °C (datasheet formula).
inline float mpuTempC(int16_t raw) { return raw / 340.0f + 36.53f; }
// Tilt (°) around X and Y from the gravity vector; meaningful while still.
inline float tiltXDeg(float ax, float ay, float az) { return atan2f(ay, sqrtf(ax * ax + az * az)) * 57.29578f; }
inline float tiltYDeg(float ax, float ay, float az) { return atan2f(-ax, sqrtf(ay * ay + az * az)) * 57.29578f; }

// Vibration: RMS of how far |a| strays from 1 g, over a window of samples.
struct RmsWindow {
  double sumSq = 0;
  uint32_t n = 0;
  void add(float ax, float ay, float az) {
    double dev = sqrt((double)ax * ax + (double)ay * ay + (double)az * az) - 1.0;
    sumSq += dev * dev;
    n++;
  }
  // The window's RMS (NAN when empty), and start a new window.
  float take() {
    float rms = n ? (float)sqrt(sumSq / n) : NAN;
    sumSq = 0;
    n = 0;
    return rms;
  }
};
