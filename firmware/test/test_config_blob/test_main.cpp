// Host-side checks for the firmware's half of the cfg blob (pio test -e native).
// The values come from config-vector.json, which the browser's encoder
// (frontend/src/lib/hardware/config-blob.test.ts) is tested against too.
#include <string.h>
#include <unity.h>

#include "crc32.h"

static const char VECTOR_JSON[] = "{\"v\":1,\"board\":\"esp32\",\"device\":{\"tenant\":\"demo\",\"device\":\"sensor01\"}}";
static const uint32_t VECTOR_CRC32 = 0x6069ff13u;

void setUp() {}
void tearDown() {}

void test_crc32_is_the_zlib_crc() {
  TEST_ASSERT_EQUAL_HEX32(0xcbf43926u, crc32Ieee((const uint8_t*)"123456789", 9));
}

void test_crc32_matches_the_shared_vector() {
  TEST_ASSERT_EQUAL_HEX32(VECTOR_CRC32, crc32Ieee((const uint8_t*)VECTOR_JSON, strlen(VECTOR_JSON)));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_crc32_is_the_zlib_crc);
  RUN_TEST(test_crc32_matches_the_shared_vector);
  return UNITY_END();
}
