# Third-party notices

The generic firmware binaries published by `release.py` contain the libraries below, pinned in
`platformio.ini`. Each license was read from the library's own source (its LICENSE file, or the
notice in its source header where it has none). Only permissive licenses are accepted: e.g. the
popular DHTesp is GPL-3.0, so the DHT22 driver is our own code.

| Library | Version | License | Copyright | Used by |
|---|---|---|---|---|
| [bblanchon/ArduinoJson](https://github.com/bblanchon/ArduinoJson) | 7.4.2 | MIT | © 2014-2025 Benoit Blanchon | config, MQTT payloads |
| [knolleary/PubSubClient](https://github.com/knolleary/pubsubclient) | 2.8 | MIT | © 2008-2020 Nicholas O'Leary | MQTT |
| [paulstoffregen/OneWire](https://github.com/PaulStoffregen/OneWire) | 2.3.8 | MIT-style (notice in `OneWire.cpp`) | © 2007 Jim Studt and contributors; CRC code © 2000 Dallas Semiconductor | `ds18b20` |
| [milesburton/DallasTemperature](https://github.com/milesburton/Arduino-Temperature-Control-Library) | 4.0.6 | MIT | © 2024 Miles Burton | `ds18b20` |

Also compiled in, from the toolchain rather than `lib_deps`:
- **Arduino-ESP32 core** (`espressif/arduino-esp32`): LGPL-2.1. Every Arduino-based ESP32
  firmware, the generated `.ino` sketch included, links it. LGPL terms apply: keep its notice, and
  let users relink against a modified core. Our firmware source is in this repository, and
  `pio run` rebuilds it.
- **ESP-IDF** (including NimBLE and `network_provisioning`): Apache-2.0.

Each license requires its copyright and permission notice to be kept with copies of the software.
The full texts ship with the libraries' sources (`.pio/libdeps/<env>/<library>/`).

When adding a library: read its license first, add a row here, and refuse GPL/LGPL ones unless
the relinking terms have been deliberately accepted.
