# Generic device firmware

One prebuilt firmware per board type (`esp32`, `esp32c3`). Every board of a type runs the same
build. What a board reads, drives and connects to comes from a **config blob** that the dashboard
writes into the board's `cfg` partition when it flashes it from the browser. Nothing is compiled
per device, and users never see code. The per-device `.ino` download
(`frontend/src/lib/firmware-sketch.ts`) stays as the advanced path for hardware this firmware
doesn't support.

The device contract (CLAUDE.md §4) is the same as the generated sketch's: same topics, payloads,
Last-Will and BLE provisioning. Keep `src/io.cpp` and `src/net.cpp` in step with `buildSketch()`.

## Layout

| Path | What |
|---|---|
| `platformio.ini` | Builds (`esp32`, `esp32c3`), pinned platform and library versions; `native` for host tests |
| `partitions.csv` | 4 MB: nvs, otadata, two OTA app slots, `cfg` (32 KB). **`cfg`'s offset is part of the flashing contract** |
| `src/config.*` | Reads and validates the `cfg` blob (format in `config.h`) |
| `src/pins.*` | Which GPIOs bindings may use, and the rules (ADC1, input-only, no sharing) |
| `src/io.*` | Builds drivers from bindings; telemetry publish profiles, commands, acks, desired state |
| `src/net.*` | Wi-Fi / BLE provisioning, MQTT, status + Last-Will |
| `src/drivers/` | One file per driver plus `registry.cpp`. Adding one: [docs/firmware/drivers.md](../docs/firmware/drivers.md) |
| `drivers.json` | The driver catalog the dashboard reads: pins, params, channels, wiring notes |
| `release.py` | Builds both boards, checks sizes and the catalog, and writes the release + `manifest.json` |
| `test/` | Host-side unit tests, plus `config-vector.json`, shared with the browser's encoder tests |

## Build, test, release

Needs PlatformIO (`uv tool install platformio`). The first build downloads the toolchains: several
GB and about 15 minutes.

```bash
cd firmware
pio run                      # both boards
pio test -e native           # host-side unit tests
python3 release.py --dev     # build + package to infra/firmware/<version>/ and frontend/public/firmware/
```

Bump `FW_VERSION` in `src/version.h` for every release. `release.py` fails if `drivers.json` and
`src/drivers/registry.cpp` list different drivers, or if an app outgrows its OTA slot. It also warns
above 90%.

## Size (open decision)

| Board | App | Share of a 1.875 MB OTA slot |
|---|---|---|
| ESP32 | 1.91 MB | **97%** |
| ESP32-C3 | 1.56 MB | 79% |

**The difference is Bluetooth.** The ESP32's Arduino libraries are built with Bluedroid (BLE +
Classic BT), and the C3's with NimBLE. Provisioning only needs BLE.

**Switching the ESP32 to NimBLE was tried and doesn't build.** The attempt used pioarduino's
`custom_sdkconfig` with NimBLE on and Bluedroid off. Arduino's `WiFiProv` includes Bluedroid's
`SimpleBLE.h` on the ESP32, so the build fails. The ways forward:

1. **Call ESP-IDF's `network_provisioning` directly instead of `WiFiProv`.** It supports NimBLE
   and the same phone app and QR, and keeps OTA. This costs a custom-sdkconfig build (much slower
   the first time) and a provisioning rewrite in `net.cpp`.
2. **One big app partition on the ESP32 (no OTA slot).** Room for every driver, but ESP32 boards
   could only be updated over USB.
3. **Stay at 97%** and keep the ESP32 driver set small.

## Trying it on a board

1. `python3 release.py --dev`.
2. Open `http://localhost:3000/dev/flash` (dev builds only; it needs no API, so a second
   `pnpm dev -p 3001` works too) in Chrome or Edge.
3. Edit the config JSON: tenant and device slugs, broker, the device's MQTT credential, and
   bindings. Then click **Connect and flash**.

The page times each step. Watch the board's log with any serial monitor at 115200 baud
(`pio device monitor` from Windows, or the Arduino IDE's monitor). A board whose config is missing
or invalid blinks its LED fast, says why on serial every 5 s, and stays offline.
