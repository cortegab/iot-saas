// Host-side checks for the drivers' arithmetic (pio test -e native).
#include <unity.h>

#include "drivers/driver_math.h"

void setUp() {}
void tearDown() {}

void test_pwm_maps_clamps_and_inverts() {
  TEST_ASSERT_EQUAL_UINT32(0, pwmDuty(0, 0, 100, 10, false));
  TEST_ASSERT_EQUAL_UINT32(1023, pwmDuty(100, 0, 100, 10, false));
  TEST_ASSERT_EQUAL_UINT32(512, pwmDuty(50, 0, 100, 10, false));
  TEST_ASSERT_EQUAL_UINT32(1023, pwmDuty(150, 0, 100, 10, false));  // clamped
  TEST_ASSERT_EQUAL_UINT32(0, pwmDuty(-5, 0, 100, 10, false));
  TEST_ASSERT_EQUAL_UINT32(1023, pwmDuty(0, 0, 100, 10, true));
  TEST_ASSERT_EQUAL_UINT32(0, pwmDuty(5, 3, 3, 10, false));  // degenerate range: off
}

void test_servo_angle_to_pulse_and_duty() {
  TEST_ASSERT_EQUAL_FLOAT(500, servoPulseUs(0, 0, 180, 500, 2500));
  TEST_ASSERT_EQUAL_FLOAT(1500, servoPulseUs(90, 0, 180, 500, 2500));
  TEST_ASSERT_EQUAL_FLOAT(2500, servoPulseUs(270, 0, 180, 500, 2500));  // clamped
  // 1500 µs of a 20 ms period at 14 bits = 7.5% of 16383.
  TEST_ASSERT_EQUAL_UINT32(1229, servoDuty(1500, 14));
}

void test_pulse_rate_per_minute() {
  TEST_ASSERT_EQUAL_FLOAT(60, pulseRatePerMin(5, 5000, 1));      // 1 pulse/s
  TEST_ASSERT_EQUAL_FLOAT(1.2f, pulseRatePerMin(45, 5000, 450));  // 450 pulses per litre
  TEST_ASSERT_TRUE(isnan(pulseRatePerMin(5, 0, 1)));
  TEST_ASSERT_TRUE(isnan(pulseRatePerMin(5, 5000, 0)));
}

void test_echo_to_cm() {
  TEST_ASSERT_FLOAT_WITHIN(0.1f, 17.15f, echoUsToCm(1000));
  TEST_ASSERT_FLOAT_WITHIN(0.5f, 400.0f, echoUsToCm(23324));
}

void test_ds18b20_conversion_time() {
  TEST_ASSERT_EQUAL_UINT32(93, ds18b20ConversionMs(9));
  TEST_ASSERT_EQUAL_UINT32(750, ds18b20ConversionMs(12));
}

void test_dht22_decode() {
  // 65.2 %RH, 35.1 °C (datasheet-style example), then a negative temperature.
  const uint8_t ok[5] = {0x02, 0x8C, 0x01, 0x5F, 0xEE};
  float t = 0, h = 0;
  TEST_ASSERT_TRUE(dht22Decode(ok, t, h));
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 65.2f, h);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 35.1f, t);
  const uint8_t neg[5] = {0x02, 0x8C, 0x80, 0x65, 0x73};
  TEST_ASSERT_TRUE(dht22Decode(neg, t, h));
  TEST_ASSERT_FLOAT_WITHIN(0.01f, -10.1f, t);
  const uint8_t bad[5] = {0x02, 0x8C, 0x01, 0x5F, 0x00};
  TEST_ASSERT_FALSE(dht22Decode(bad, t, h));
}

void test_mpu6050_conversions_and_tilt() {
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, mpuAccelG(8192, 4));    // ±4 g: 8192 counts/g
  TEST_ASSERT_FLOAT_WITHIN(0.001f, -0.5f, mpuAccelG(-2048, 8));  // ±8 g: 4096 counts/g
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 100.0f, mpuGyroDps(6550));
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 36.53f, mpuTempC(0));
  // Flat (gravity on Z): no tilt. Rolled 90° (gravity on Y): tilt_x 90.
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, tiltXDeg(0, 0, 1));
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, tiltYDeg(0, 0, 1));
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 90.0f, tiltXDeg(0, 1, 0));
  TEST_ASSERT_FLOAT_WITHIN(0.01f, -90.0f, tiltYDeg(1, 0, 0));
}

void test_vibration_rms() {
  RmsWindow w;
  TEST_ASSERT_TRUE(isnan(w.take()));
  w.add(0, 0, 1);  // still: |a| = 1 g → 0
  w.add(0, 0, 1);
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, 0.0f, w.take());
  w.add(0, 0, 1.5f);  // +0.5 g
  w.add(0, 0, 0.5f);  // -0.5 g
  TEST_ASSERT_FLOAT_WITHIN(0.0001f, 0.5f, w.take());
  TEST_ASSERT_TRUE(isnan(w.take()));  // take() starts a new window
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_pwm_maps_clamps_and_inverts);
  RUN_TEST(test_servo_angle_to_pulse_and_duty);
  RUN_TEST(test_pulse_rate_per_minute);
  RUN_TEST(test_echo_to_cm);
  RUN_TEST(test_ds18b20_conversion_time);
  RUN_TEST(test_dht22_decode);
  RUN_TEST(test_mpu6050_conversions_and_tilt);
  RUN_TEST(test_vibration_rms);
  return UNITY_END();
}
