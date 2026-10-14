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
| `pulse_counter` | flow, energy, wind | core: ESP-IDF 5 `driver/pulse_cnt.h` | channels `count`, `rate`; param pulses_per_unit | planned |
| `ds18b20` | 1-Wire temperature | `paulstoffregen/OneWire` + `milesburton/DallasTemperature` | non-blocking conversion; several probes per pin, by address | planned |
| `dht22` | temperature + humidity | `beegee-tokyo/DHT sensor library for ESPx` | at most one read every 2 s | planned |
| `bme280` | temp, humidity, pressure (I2C 0x76/0x77) | `adafruit/Adafruit BME280 Library` | pulls `Adafruit Unified Sensor`, `Adafruit BusIO` | planned |
| `sht3x` | temp, humidity (I2C 0x44/0x45) | `adafruit/Adafruit SHT31 Library` | | planned |
| `ads1115` | 4-channel 16-bit ADC (I2C 0x48–0x4B) | `adafruit/Adafruit ADS1X15` | params per channel: gain, scale, offset | planned |
| `mpu6050` | GY-521 accel + gyro (I2C 0x68/0x69) | `adafruit/Adafruit MPU6050` | derived channels `tilt_x`, `tilt_y`, `vibration_rms`; raw axes only for streaming | planned |
| `pwm` | dimmers, fan speed, valves | core (LEDC: `ledcAttach` / `ledcWrite`) | params: freq_hz, resolution_bits, in_min/in_max | planned |
| `servo` | hobby servos | `madhephaestus/ESP32Servo` | params: min_us, max_us, angle range; needs its own 5 V supply | planned |

Re-check a library's registry name, its maintenance and its ESP32 core 3.x support when adding it.
**Licenses:** you distribute binaries that contain these libraries. Check each one's license
before shipping and list it in `firmware/THIRD_PARTY_NOTICES.md`. Most are MIT or BSD; LGPL ones
need attribution plus relinking terms.

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
   - pins: each with a role and `needs` (`input`, `output`, `adc1`, or a bus)
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
