#pragma once

// What io.cpp's telemetry publishing decides, as pure arithmetic: no Arduino,
// so it's host-tested (test/test_publish_math).

#include <math.h>
#include <stdint.h>

// A metric's decimals as the platform sends them (catalog `decimals`): absent
// means 3, which is what every firmware before 0.13.0 sent. More than 6 is
// noise on a float (~7 significant digits).
constexpr int DEFAULT_DECIMALS = 3;
constexpr int MAX_DECIMALS = 6;

inline int clampDecimals(long d) { return d < 0 ? 0 : (d > MAX_DECIMALS ? MAX_DECIMALS : (int)d); }

// The value as it will be sent: rounded to `decimals`.
inline float roundToDecimals(float value, int decimals) {
  float scale = powf(10.0f, (float)decimals);
  return roundf(value * scale) / scale;
}

// "On change": has the rounded value moved by more than the deadband, and by
// at least one step of its last decimal? Both values are already rounded, so
// their difference is a whole number of steps; counting steps keeps float
// error (25.2 - 25.0 = 0.2000008) from turning "up to 0.2" into "over 0.2".
inline bool changedEnough(float rounded, float lastRounded, float deadband, int decimals) {
  float step = 1.0f / powf(10.0f, (float)decimals);
  long steps = lroundf(fabsf(rounded - lastRounded) / step);
  return steps >= 1 && (float)steps * step > deadband + step * 1e-3f;
}

// A token bucket: at most `perSecond` messages a second on average, bursts of
// up to `perSecond`. A message that finds no token waits for the next pass,
// carrying the latest value then (coalesced, never queued).
class RateLimiter {
 public:
  explicit RateLimiter(uint32_t perSecond) : rate_(perSecond), tokens_((float)perSecond) {}

  bool take(uint32_t nowMs) {
    if (started_) {
      tokens_ += (float)(nowMs - lastMs_) * (float)rate_ / 1000.0f;
      if (tokens_ > (float)rate_) tokens_ = (float)rate_;
    }
    started_ = true;
    lastMs_ = nowMs;
    if (tokens_ < 1.0f) return false;
    tokens_ -= 1.0f;
    return true;
  }

 private:
  uint32_t rate_;
  float tokens_;
  uint32_t lastMs_ = 0;
  bool started_ = false;
};
