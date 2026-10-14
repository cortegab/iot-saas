// Host-side checks for the status LED patterns (pio test -e native).
#include <unity.h>

#include "led_pattern.h"

void setUp() {}
void tearDown() {}

// How many ms of the first second the LED is lit, and how many times it turns on.
static void measure(LedState s, int& litMs, int& flashes) {
  litMs = 0;
  flashes = 0;
  bool was = false;
  for (uint32_t t = 0; t < 1000; t++) {
    bool on = ledPatternAt(s, t);
    if (on) litMs++;
    if (on && !was) flashes++;
    was = on;
  }
}

void test_running_is_off() {
  int lit, flashes;
  measure(LedState::Running, lit, flashes);
  TEST_ASSERT_EQUAL(0, lit);
}

void test_fault_blinks_fast() {
  int lit, flashes;
  measure(LedState::Fault, lit, flashes);
  TEST_ASSERT_EQUAL(4, flashes);  // 150 ms on / 150 ms off
  TEST_ASSERT_TRUE(ledPatternAt(LedState::Fault, 0));
  TEST_ASSERT_FALSE(ledPatternAt(LedState::Fault, 150));
}

void test_provisioning_blinks_slowly() {
  TEST_ASSERT_TRUE(ledPatternAt(LedState::Provisioning, 0));
  TEST_ASSERT_TRUE(ledPatternAt(LedState::Provisioning, 999));
  TEST_ASSERT_FALSE(ledPatternAt(LedState::Provisioning, 1000));
  TEST_ASSERT_TRUE(ledPatternAt(LedState::Provisioning, 2000));
}

void test_connecting_double_blinks_each_second() {
  int lit, flashes;
  measure(LedState::Connecting, lit, flashes);
  TEST_ASSERT_EQUAL(2, flashes);
  TEST_ASSERT_EQUAL(200, lit);
  TEST_ASSERT_TRUE(ledPatternAt(LedState::Connecting, 1000));  // repeats
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_running_is_off);
  RUN_TEST(test_fault_blinks_fast);
  RUN_TEST(test_provisioning_blinks_slowly);
  RUN_TEST(test_connecting_double_blinks_each_second);
  return UNITY_END();
}
