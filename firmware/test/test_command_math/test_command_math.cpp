// Host-side checks for command expiry (pio test -e native).
#include <unity.h>

#include "command_math.h"

void setUp() {}
void tearDown() {}

const int64_t NOW = 1770001111;

void test_fresh_command_is_acted_on() { TEST_ASSERT_FALSE(commandExpired(NOW, NOW - 5, 30)); }

void test_stale_command_is_dropped() { TEST_ASSERT_TRUE(commandExpired(NOW, NOW - 95, 30)); }

void test_grace_covers_small_clock_disagreement() {
  TEST_ASSERT_FALSE(commandExpired(NOW, NOW - 31, 30));
  TEST_ASSERT_FALSE(commandExpired(NOW, NOW - 32, 30));
  TEST_ASSERT_TRUE(commandExpired(NOW, NOW - 33, 30));
}

void test_unknown_clock_or_missing_fields_act_as_before() {
  TEST_ASSERT_FALSE(commandExpired(12, NOW - 95, 30));  // clock not set yet
  TEST_ASSERT_FALSE(commandExpired(NOW, 0, 30));        // no issued_at
  TEST_ASSERT_FALSE(commandExpired(NOW, NOW - 95, 0));  // no ttl
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_fresh_command_is_acted_on);
  RUN_TEST(test_stale_command_is_dropped);
  RUN_TEST(test_grace_covers_small_clock_disagreement);
  RUN_TEST(test_unknown_clock_or_missing_fields_act_as_before);
  return UNITY_END();
}
