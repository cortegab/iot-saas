# Hardware drivers

The generic firmware (`firmware/`) supports a fixed set of sensors and actuators, each one a
**driver**. A device template binds drivers to metrics and actuators: which driver, on which GPIOs,
with which params, and which metric each of its channels feeds. The dashboard writes that binding
into the board's config when it flashes it, so users never edit code.

A binding, as it appears in the config blob:

```json
{ "driver": "relay", "pins": { "pin": 23 }, "params": { "active_low": true }, "channels": { "value": "fan1" } }
```

## Drivers and their libraries

Every library is pinned to an exact version in `firmware/platformio.ini`
(`lib_deps = owner/name @ x.y.z`) and compiled into the release. Nothing is downloaded when a user
flashes a board.

| Driver id | Hardware | Library (PlatformIO registry) | Notes | Status |
|---|---|---|---|---|
| (core) | MQTT | `knolleary/PubSubClient` | same as the generated sketch | ✅ |
| (core) | JSON | `bblanchon/ArduinoJson` | | ✅ |
| (core) | BLE provisioning, Wi-Fi, TLS | ESP-IDF `network_provisioning` (NimBLE) and the Arduino core's `WiFiClientSecure` | no download | ✅ |
| `digital_in` | contacts, buttons, PIR | core (`digitalRead`) | params: pull, invert, debounce_ms | ✅ |
| `analog_in` | 0–3.3 V sensors | core (`analogReadMilliVolts`) | ADC1 pins only; params: scale, offset, samples | ✅ |
| `relay` | relay modules, digital out | core (`digitalWrite`) | params: active_low, boot_state | ✅ |
| `pulse_counter` | flow, energy, wind, buttons | core: GPIO interrupt (IRAM ISR) | channels `total`, `rate_per_min`; params edge, pull, pulses_per_unit, min_gap_us, window_s. Works on the C3 too (no PCNT there); up to ~10 kHz | ✅ 0.5.0 |
| `ds18b20` | 1-Wire temperature | `paulstoffregen/OneWire` + `milesburton/DallasTemperature` | non-blocking conversion; up to 4 probes per pin (`temp_1`…`temp_4`, address order); −127 / power-on 85 → unknown | ✅ 0.5.0 |
| `dht22` | temperature + humidity | own code (the common DHTesp is GPL-3.0) | at most one read every 2 s; unknown after 2 failed reads | ✅ 0.5.0 |
| `hcsr04` | ultrasonic distance | core: trigger + CHANGE interrupt on echo | channel `distance_cm`; out of range or no echo → unknown. **ECHO is 5 V: divider needed** | ✅ 0.5.0 |
| `mpu6050` | GY-521 accel + gyro (I2C 0x68/0x69) | own register reads over `Wire` | channels `tilt_x`, `tilt_y`, `vibration_rms`, `temperature`, raw `accel_*`/`gyro_*`; first I2C driver | ✅ 0.5.0 |
| `pwm` | dimmers, fan speed, valves | core (LEDC: `ledcAttach` / `ledcWrite`) | params: freq_hz, resolution_bits, in_min/in_max, invert, boot_value | ✅ 0.5.0 |
| `servo` | hobby servos | core (LEDC at 50 Hz, 14-bit): no library | params: min_us, max_us, angle range, boot_angle; needs its own 5 V supply | ✅ 0.5.0 |
| `bme280` | temp, humidity, pressure (I2C 0x76/0x77) | `adafruit/Adafruit BME280 Library` | pulls `Adafruit Unified Sensor`, `Adafruit BusIO` | batch 2 |
| `sht3x` | temp, humidity (I2C 0x44/0x45) | `adafruit/Adafruit SHT31 Library` | | batch 2 |
| `ads1115` | 4-channel 16-bit ADC (I2C 0x48–0x4B) | `adafruit/Adafruit ADS1X15` | params per channel: gain, scale, offset | batch 2 |
| `bh1750`, `ina219`, `mcp4725` | lux; V/A/W; DAC output (I2C) | to choose | | batch 2 |

### I2C drivers

I2C drivers take no pins of their own. In `drivers.json` they declare `"bus": "i2c"`, the
`"addresses"` the part can be set to, and an `address` enum param. When a template adds its first
I2C driver, the editor sets `hardware.i2c` (SDA/SCL) to the board model's default (`i2c` in
`firmware/boards.json`); it clears it when the last one goes. Two I2C bindings can't share an
address. The firmware starts `Wire` on those pins before the drivers' `begin()`, and drivers check
`i2cBusReady()`.

Default bus pins: ESP32 DevKits SDA 21 / SCL 22; ESP32-C3 Super Mini SDA 5 / SCL 6 (its GPIO 8/9,
often printed SDA/SCL, are the LED and BOOT pins, which the firmware reserves).

### Covered by existing drivers

| Part | Use | Notes |
|---|---|---|
| TTP223 touch | `digital_in` | the module drives its output, so pull `none` |
| MH-series modules (soil, rain, flame, light…) | DO → `digital_in`, AO → `analog_in` | AO on an ADC1 pin; power the module from 3.3 V so AO stays under 3.3 V |
| KY-023 joystick | 2× `analog_in` (VRx, VRy) + `digital_in` (SW, pull `up`, invert) | ADC1 pins; 3.3 V supply |
| PIR, reed switch, button | `digital_in` | |
| Capacitive soil moisture, MQ-2, 4–20 mA through a shunt | `analog_in` with scale/offset | |
| Relay, solenoid (via driver), active buzzer, MOSFET on/off | `relay` | |

### Not yet

- **RC522 / PN532 RFID:** a card UID isn't a number, and telemetry values are numbers only. It
  needs a design first (e.g. "card present" plus an allowlist that maps cards to numbers).
- **WS2812B, SSD1306, MCP23017, MCP2515:** each needs a design (colour values, a display concept,
  pins on an expander, CAN).
- **Roadmap:** batch 2 I2C (above); batch 3 serial (`modbus_rtu`, `pzem004t`, `gps`); batch 4
  motors (`dc_motor`, `stepper`).

Re-check a library's registry name, its maintenance and its ESP32 core 3.x support when adding it.
**Licenses:** you distribute binaries that contain these libraries. Check each one's license
before shipping and list it in `firmware/THIRD_PARTY_NOTICES.md`. Most are MIT or BSD; LGPL ones
need attribution plus relinking terms; GPL ones are refused (write the driver instead, as with
`dht22`).

## Adding a driver

1. **Choose a library:**
   - Is it on the PlatformIO registry, maintained, and working with ESP32 Arduino core 3.x?
   - Can it read without blocking for long? `delay()`-heavy libraries need wrapping in a state
     machine.
   - What license does it have?
2. **Pin it** in `lib_deps` in `firmware/platformio.ini` with an exact version.
3. **Write the driver** in `firmware/src/drivers/<id>.cpp`, implementing `InputDriver` or
   `OutputDriver` (`firmware/src/drivers/driver.h`):
   - `begin()` claims its pins through `claimPin()` (which enforces the board's pin rules) and
     validates every param with the `intParam`/`floatParam`/`boolParam` helpers. On a bad
     binding it returns `false` with a message a person can act on; it never crashes.
   - `poll()` is non-blocking. Time things with `nowMs`, and respect the sensor's minimum
     interval.
   - `read()` returns `NAN` when there's no fresh reading. The platform treats that as unknown,
     never as a value.
   - `channels()` lists the channel names a template can map.
   - Outputs apply their safe boot state in `begin()`, before Wi-Fi comes up.
   - Allocate in `begin()`, never per loop.
4. **Register it:** one line in `firmware/src/drivers/registry.cpp`, plus the `make…()`
   declaration above it.
5. **Describe it** in `firmware/drivers.json`:
   - id, kind, label, description
   - pins: each with a role and `needs` (`input`, `output`, `adc1`, or `bus`), or none plus
     `"bus": "i2c"` and `addresses` for an I2C part
   - params: type, default, range
   - channels: with `data_type` (inputs) or `value_type` (outputs)
   - wiring notes

   The dashboard builds its editor, validation and wiring guide from this file, so a new driver
   needs no frontend change.
6. **Test it on a bench board:**
   - Flash a dev release (`python3 release.py --dev`) and a config that uses the driver, from
     `/dev/flash`.
   - Check the readings on the live chart. Unplug the sensor: it must go quiet (unknown), never
     report a wrong value. Power-cycle the board.
   - Put pure math (scaling, RMS, tilt) in a host test under `firmware/test/`.
7. **Release:**
   - Bump `FW_VERSION`, then run `python3 release.py`. It fails if the driver isn't both
     registered and in `drivers.json`, or if the app outgrew its slot.
   - Update `THIRD_PARTY_NOTICES.md`.
   - Deploy `infra/firmware/`.
8. **Roll out:** new installs get the driver right away. Boards already in the field get it on
   their next full flash, and later through OTA updates.
