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
| `boards.json` | The board models people pick (30-/38-pin ESP32 DevKit, ESP32-C3 Super Mini): chip, header pins, labels, reset button, LED |
| `release.py` | Builds each chip, checks sizes and both catalogs, and writes the release + `manifest.json` |
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

Bump `FW_VERSION` in `src/version.h` for every release. `release.py` fails if:
- `drivers.json` and `src/drivers/registry.cpp` list different drivers
- `src/board.h` or `src/pins.cpp` lacks a block for a chip it builds, or has one it doesn't
- `CHIP_PINS` in `frontend/src/lib/hardware/board-pins.ts` disagrees with `src/pins.cpp`
- a board model in `boards.json` offers a pin `src/pins.cpp` refuses for its chip, offers its own
  reset or LED pin for wiring, or has an unknown `led.type` or capability
- an app outgrows its OTA slot

It also warns when an app is above 90% of its slot.

**How a release reaches prod:** you don't publish it by hand. On a deploy, the workflow builds the
release in CI when the commit's `FW_VERSION` is new, and copies it to the VPS, where nginx serves
it at `/firmware/`. That's why every firmware change must bump the version: an unchanged version
is never rebuilt. Details are in `infra/PROD_DEPLOY.md`, "Firmware releases".

## Boards: chips and models

**One firmware build per chip, many board models per chip.** The 30-pin and the 38-pin ESP32
DevKit run the same `esp32` build. What differs is which GPIOs are on the header and how they're
labelled, and that lives in `boards.json`.

- **The config blob's `board`** is the chip, and the firmware checks it against its own build.
- **Its `model`** is the board model id, which the firmware only logs.
- **Its `board_io`** carries the model's reset button and status LED (`reset_pin`, `led: {type,
  pin, active_low}`), so models of one chip can differ there. It's optional and additive: firmware
  before 0.6.0 ignores it, and 0.6.0+ falls back to the chip's defaults in `src/board.h` without
  it. The firmware reserves both pins, so a binding on one fails at boot with the owner named.
- **Templates store the model id** (`hardware.board`). The backend checks only the id's shape, so a
  new model needs no backend change.

### Adding a board

**A new model of a chip we already build** (for example an ESP32-C3 DevKitM) is data only:
1. Add an entry to `boards.json`:
   - `id` (kebab-case, never renamed once used), `chip`, `label`, `description`
   - `pins`: the free GPIOs on its header, a subset of the chip's `USABLE` in `src/pins.cpp`
   - `pin_labels`: printed names that differ from the number, such as VP, VN, RX or TX
   - `reset`: its provisioning-reset button (`pin`, and a `label` people read)
   - `led`: its status LED, `type` `gpio`, `rgb` (addressable, like the S3/C6 DevKits) or `none`,
     plus `pin` and `active_low`. Both may differ from the chip's defaults in `src/board.h`.
   - `capabilities`: `ble` when Wi-Fi can be set up from a phone, `rgb_led` when `led.type` is `rgb`
   - `notes`: anything a person wiring it should know
2. Bump `FW_VERSION`, then run `release.py`. It refuses pins the firmware wouldn't accept.
3. Deploy. The dashboard offers the model as soon as the release is live.

**A new chip** (for example the ESP32-S3):
1. Add a PlatformIO env, plus its `#elif CONFIG_IDF_TARGET_…` block in `src/board.h` and
   `src/pins.cpp`. A chip without one doesn't build (`#error`).
2. Add it to `BOARDS` in `release.py` (env, esptool chip name, bootloader offset).
3. Add it to `CHIPS` and `BOARDS` (`frontend/src/lib/firmware-sketch.ts`) and mirror its pin rules
   in `CHIP_PINS` (`frontend/src/lib/hardware/board-pins.ts`). TypeScript then flags every
   per-chip table that misses it, and `release.py` checks `CHIP_PINS` against `src/pins.cpp`.
4. Add a model for it in `boards.json`.
5. Add an alembic data migration only if stored values need renaming. They don't for a new chip.

## Size

| Board | App (0.5.0) | Share of a 1.875 MB OTA slot |
|---|---|---|
| ESP32 | 1.43 MB | 73% |
| ESP32-C3 | 1.55 MB | 79% |

**The ESP32 builds with NimBLE, not Bluedroid.** The prebuilt Arduino libraries for the ESP32 use
Bluedroid (BLE + Classic BT), and provisioning only needs BLE. Up to 0.3.x that put the ESP32 at
1.91 MB, 97% of a slot. `[env:esp32]` now recompiles the framework with NimBLE
(`custom_sdkconfig`). The first build is slow (~10 min) and later builds are cached.

**That's why provisioning is ours, not `WiFiProv`.** On the ESP32, Arduino's `WiFiProv` includes
Bluedroid's `SimpleBLE.h`, which won't build against NimBLE. `src/provisioning.cpp` makes the same
`network_provisioning` calls `WiFiProv` made, with the same service UUID, name, security levels and
events, so the phone app and QR didn't change. `lib_ignore` keeps `WiFiProv` and the
Bluedroid-only Arduino BLE libraries out of the build.

**Checking it after a change:** the linker map should show no Bluedroid at all.
`grep -c 'btc_\|bta_' .pio/build/esp32/firmware.map` should print `0`.

## Status LED

The board's built-in LED is reserved for the firmware (ESP32 DevKits: GPIO 2; ESP32-C3 Super
Mini: GPIO 8; each model's `led` in `boards.json`). It's never offered for wiring. An RGB LED
blinks dim blue. It shows where the board is, so you don't need a serial monitor:

| LED | Meaning | What to do |
|---|---|---|
| **Off** | Connected and working | Nothing |
| **Slow blink** (1 s on, 1 s off) | Waiting for Wi-Fi from the phone | Scan the device's QR with the ESP BLE Provisioning app |
| **Double blink**, every second | Joining Wi-Fi or the MQTT broker | Wait. If it keeps going, check the Wi-Fi is in range and the broker is reachable, and that the credential hasn't been rotated since the flash |
| **Fast blink** (about 3 times a second) | The config is missing or invalid; the board stays offline | Install the config again from the dashboard. The serial log says why every 5 s |

The patterns live in `src/led_pattern.h` and are host-tested (`test/test_led_pattern`). Keep this
table in step with `src/led.h`.

## Trying it on a board

1. `python3 release.py --dev`.
2. Open `http://localhost:3000/dev/flash` (dev builds only; it needs no API, so a second
   `pnpm dev -p 3001` works too) in Chrome or Edge.
3. Edit the config JSON: tenant and device slugs, broker, the device's MQTT credential, and
   bindings. Then click **Connect and flash**.

The page times each step. Watch the board's log with any serial monitor at 115200 baud
(`pio device monitor` from Windows, or the Arduino IDE's monitor). A board whose config is missing
or invalid blinks its LED fast, says why on serial every 5 s, and stays offline.
