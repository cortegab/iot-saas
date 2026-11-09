// Host-side checks for telemetry publishing decisions (pio test -e native).
#include <unity.h>

#include "publish_math.h"

void setUp() {}
void tearDown() {}

void test_decimals_are_clamped() {
  TEST_ASSERT_EQUAL_INT(0, clampDecimals(-2));
  TEST_ASSERT_EQUAL_INT(4, clampDecimals(4));
  TEST_ASSERT_EQUAL_INT(6, clampDecimals(10));
}

void test_rounds_to_decimals() {
  TEST_ASSERT_FLOAT_WITHIN(1e-6, 0.049f, roundToDecimals(0.04863f, 3));
  TEST_ASSERT_FLOAT_WITHIN(1e-6, 0.0486f, roundToDecimals(0.04863f, 4));
  TEST_ASSERT_FLOAT_WITHIN(1e-6, 27.0f, roundToDecimals(27.44f, 0));
  TEST_ASSERT_FLOAT_WITHIN(1e-6, -1.5f, roundToDecimals(-1.46f, 1));
}

void test_change_below_last_digit_does_not_publish() {
  // 0.0484 and 0.0486 both send as 0.048 / 0.049 at 3 decimals; equal rounded values never publish.
  TEST_ASSERT_FALSE(changedEnough(0.049f, 0.049f, 0.0f, 3));
  TEST_ASSERT_TRUE(changedEnough(0.049f, 0.048f, 0.0f, 3));
}

void test_deadband_applies_to_rounded_values() {
  TEST_ASSERT_FALSE(changedEnough(25.2f, 25.0f, 0.2f, 1));  // not more than 0.2
  TEST_ASSERT_TRUE(changedEnough(25.3f, 25.0f, 0.2f, 1));
  // A deadband finer than the last digit acts as one step.
  TEST_ASSERT_TRUE(changedEnough(0.049f, 0.048f, 0.0005f, 3));
}

void test_rate_limiter_caps_and_refills() {
  RateLimiter r(20);
  int sent = 0;
  for (int i = 0; i < 100; i++) sent += r.take(1000) ? 1 : 0;  // a burst at one instant
  TEST_ASSERT_EQUAL_INT(20, sent);
  TEST_ASSERT_FALSE(r.take(1000));
  TEST_ASSERT_FALSE(r.take(1040));  // 0.8 of a token back
  TEST_ASSERT_TRUE(r.take(1050));   // one token after 50 ms
  sent = 0;
  for (uint32_t t = 2000; t < 4000; t += 10) sent += r.take(t) ? 1 : 0;  // 2 s of asking every 10 ms
  TEST_ASSERT_INT_WITHIN(21, 40, sent);  // ~20/s plus at most one refilled burst
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_decimals_are_clamped);
  RUN_TEST(test_rounds_to_decimals);
  RUN_TEST(test_change_below_last_digit_does_not_publish);
  RUN_TEST(test_deadband_applies_to_rounded_values);
  RUN_TEST(test_rate_limiter_caps_and_refills);
  return UNITY_END();
}
