#include <unity.h>

#include "version_math.h"

void setUp() {}
void tearDown() {}

void test_newer_patch_minor_major() {
  TEST_ASSERT_TRUE(isNewerVersion("1.0.2", "1.0.1"));
  TEST_ASSERT_TRUE(isNewerVersion("1.1.0", "1.0.9"));
  TEST_ASSERT_TRUE(isNewerVersion("2.0.0", "1.9.9"));
  TEST_ASSERT_TRUE(isNewerVersion("1.0.10", "1.0.9"));  // numeric, not text order
}

void test_same_or_older_is_refused() {
  TEST_ASSERT_FALSE(isNewerVersion("1.0.1", "1.0.1"));
  TEST_ASSERT_FALSE(isNewerVersion("1.0.0", "1.0.1"));
  TEST_ASSERT_FALSE(isNewerVersion("0.15.1", "1.0.1"));
}

void test_unparseable_is_never_newer() {
  TEST_ASSERT_FALSE(isNewerVersion("", "1.0.1"));
  TEST_ASSERT_FALSE(isNewerVersion("1.0", "1.0.1"));
  TEST_ASSERT_FALSE(isNewerVersion("1.0.2-beta", "1.0.1"));
  TEST_ASSERT_FALSE(isNewerVersion("v1.0.2", "1.0.1"));
  TEST_ASSERT_FALSE(isNewerVersion("99999.0.0", "1.0.1"));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_newer_patch_minor_major);
  RUN_TEST(test_same_or_older_is_refused);
  RUN_TEST(test_unparseable_is_never_newer);
  return UNITY_END();
}
