# BLE Wi-Fi provisioning — device contract

How a board flashed with a dashboard-generated sketch (`frontend/src/lib/firmware-sketch.ts`)
receives its Wi-Fi credentials from a phone. Like the MQTT contract in CLAUDE.md §4, this is
shared with the single-tenant deployment variant: **apply every change here to both**, with
already-flashed boards in mind.

Provisioning is **Espressif's unified provisioning** (protocomm over BLE), driven on the board by
the Arduino core's `WiFiProv` library (ESP32 board package 3.x, `NETWORK_PROV_*` API). Any client
that speaks it works: today the **ESP BLE Provisioning** app (Android / iOS) and Espressif's
`esp_prov.py`; the future iodriven app embeds Espressif's provisioning libraries.

> Replaces the earlier custom GATT service (`6e1f0001-…` UUIDs). Boards flashed with that firmware
> that are already on Wi-Fi keep working; to provision one again, flash a newly generated sketch.

## When a board is provisionable

- The sketch is generated with **"Set up from a phone"** (connect flow, Options step). With
  "Type it into the sketch" there is no BLE code at all.
- On boot, `WiFiProv.beginProvision(...)` connects with the Wi-Fi stored in flash (NVS) or, if there
  is none, starts advertising for provisioning. `reset_provisioned` is `false`.
- **Provision again:** hold **BOOT** for 5 seconds **while the board is running** (GPIO 0 on ESP32,
  GPIO 9 on ESP32-C3). The sketch erases the stored network and restarts into provisioning. Holding
  BOOT while powering up starts the bootloader instead.

## Identity and secrets

Provisioning reuses the device's **own MQTT credential**. No separate secret exists.

| | Value |
|---|---|
| Service name (BLE name, QR `name`, sketch `PROV_NAME`) | the device name in printable ASCII, accents dropped, ≤ 29 bytes (`provName()`) |
| Proof of possession / SRP password (QR `pop`) | the device's MQTT password |
| SRP username (QR `username`, Security 2 only) | the device's MQTT username, i.e. the device id |

- The credential is stored hashed on the platform and shown once, so the QR exists only in the
  connect flow, right after Create / Rotate credential. **Rotating the credential means a new sketch
  and a new QR**; the old QR stops working once the new sketch is flashed.
- The QR, and any printed label, contains the device's broker password: keep it like a key.
- A device renamed after flashing keeps advertising the name it was flashed with; the QR generated
  with that sketch carries the same name.

## Security levels

Chosen in the connect flow's Options step.

| | Security 1 – PoP | Security 2 – SRP6a (default) |
|---|---|---|
| Firmware | `NETWORK_PROV_SECURITY_1`, PoP = `MQTT_PASSWORD` | `NETWORK_PROV_SECURITY_2`, `network_prov_security2_params_t` with `SEC2_SALT[]` / `SEC2_VERIFIER[]` |
| Handshake | Curve25519 + AES-CTR keyed with the PoP | SRP6a (3072-bit group, SHA-512): a captured session can't be used to guess the password offline |
| App | every version | ESP BLE Provisioning 2.1 or later |

- **Security 2 salt and verifier** are computed in the browser by `frontend/src/lib/srp6a.ts`, a port
  matching ESP-IDF `components/protocomm/src/crypto/srp6a/esp_srp.c`:
  `x = SHA-512(salt ‖ SHA-512(username ":" password))`, `v = g^x mod N`, 16-byte salt.
- Its unit test reproduces ESP-IDF's own test vector (`test_srp.c`: `wifiprov` / `abcd1234`).
- Arduino's `beginProvision` passes its `pop` argument to ESP-IDF as `const void*`, so the sketch
  hands it `(const char*)&SEC2_PARAMS`.

## QR payload

JSON, as scanned by the ESP BLE Provisioning app (`provisioningPayload()`). `security` is always
explicit, because the app assumes 2 when it's missing.

```json
// Security 1
{"ver":"v1","name":"<device name>","pop":"<mqtt password>","transport":"ble","network":"wifi","security":1}

// Security 2
{"ver":"v1","name":"<device name>","username":"<device id>","pop":"<mqtt password>","transport":"ble","network":"wifi","security":2}
```

The app connects to the board with that exact name. To find a board **without** the QR, clear the
app's default `PROV_` name-prefix filter in its settings.

## Per-board firmware details

| | ESP32 DevKit | ESP32-C3 |
|---|---|---|
| Arduino board | ESP32 Dev Module | ESP32C3 Dev Module (USB CDC On Boot: Enabled, Flash Mode: DIO) |
| Scheme handler | `NETWORK_PROV_SCHEME_HANDLER_FREE_BTDM` | `NETWORK_PROV_SCHEME_HANDLER_FREE_BLE` |
| Extras | — | TX power 8.5 dBm on `STA_START`; `protocomm_nimble` logs off |
| Partition | Huge APP (3MB No OTA/1MB SPIFFS) | same |

Both keep `extern "C" bool btInUse() { return true; }` so the BT controller's RAM stays reserved.

## Flow

```
app                                         board
 |  scan QR (name, pop[, username], security) |  advertising as <device name> (no Wi-Fi stored)
 |  connect over BLE, open a secure session  |  Security 1: PoP · Security 2: SRP6a
 |  send SSID + passphrase  ---------------> |  [PROV] Wi-Fi received from the app
 |  <--------------------- result            |  joins → [PROV] Wi-Fi saved → [WIFI] connected
 |                                           |  → MQTT: retained status, live check turns green
```

## Testing without the app

Espressif's `esp_prov.py` (package `esp-idf-provisioning`, or ESP-IDF's tools) plays the app's role
from a computer with Bluetooth:

```bash
# Security 2
esp_prov.py --transport ble --service_name "<device name>" --sec_ver 2 \
  --sec2_username <device id> --sec2_pwd <mqtt password> --ssid "MyWifi" --passphrase "secret"

# Security 1
esp_prov.py --transport ble --service_name "<device name>" --sec_ver 1 \
  --pop <mqtt password> --ssid "MyWifi" --passphrase "secret"
```
