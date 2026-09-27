# BLE Wi-Fi provisioning — device contract

How a board flashed with a dashboard-generated sketch (`frontend/src/lib/firmware-sketch.ts`)
receives its Wi-Fi credentials over Bluetooth LE. Written for whoever builds the provisioning
app. Like the MQTT contract in CLAUDE.md §4, this is shared with the single-tenant deployment
variant: **treat the UUIDs and payloads as stable**. Changing them breaks every board already
in the field.

## When a board is provisionable

- On boot, the sketch reads Wi-Fi from flash (`Preferences` namespace `iot`, keys `ssid` / `pass`).
- **Nothing stored** → it starts BLE provisioning and waits. MQTT is not started.
- **Something stored** → it connects to that network and never starts BLE (even if the network
  is down — it keeps retrying). To provision again, re-flash with *Erase All Flash Before Sketch
  Upload* enabled.
- Development shortcut: `DEV_WIFI_SSID` / `DEV_WIFI_PASSWORD` in the sketch, if non-empty, are
  used and saved when nothing is stored, skipping BLE entirely.

## Advertising

- Local name: the device's name in the dashboard, truncated to 20 bytes.
- Advertised service UUID: `6e1f0001-7c3a-4b8e-9d2f-5a4b3c2d1e0f`. Filter scans on this.

## GATT service `6e1f0001-7c3a-4b8e-9d2f-5a4b3c2d1e0f`

| Characteristic | UUID | Properties | Payload |
|---|---|---|---|
| ssid | `6e1f0002-7c3a-4b8e-9d2f-5a4b3c2d1e0f` | write | UTF-8, 1–32 bytes |
| password | `6e1f0003-7c3a-4b8e-9d2f-5a4b3c2d1e0f` | write | UTF-8, 0–64 bytes (empty = open network) |
| control | `6e1f0004-7c3a-4b8e-9d2f-5a4b3c2d1e0f` | write | one byte: `0x01` = apply |
| status | `6e1f0005-7c3a-4b8e-9d2f-5a4b3c2d1e0f` | read, notify | JSON, see below |
| info | `6e1f0006-7c3a-4b8e-9d2f-5a4b3c2d1e0f` | read | JSON `{"device_id","topic_prefix","fw_version"}` |

`info.device_id` is the platform device UUID (also the MQTT username), so the app can match the
board it found to a device record via the API. `topic_prefix` is `{tenant}/{device}`.

**Security.** Every characteristic requires an **encrypted, bonded link** (LE Secure
Connections, "Just Works" — the board has no display or keypad). Pair before reading or writing;
an unpaired write fails with *insufficient authentication/encryption*. This keeps the Wi-Fi
password off the air in the clear. It does not authenticate *which* phone is pairing — anyone in
range can provision an unprovisioned board, which is acceptable only because a board is
provisionable only until it has Wi-Fi. A passkey is a candidate upgrade once the app exists.

## Flow

```
app                                   board
 |  scan for service 6e1f0001            |  advertising (no Wi-Fi stored)
 |  connect + pair (Just Works)          |
 |  read info  ------------------------> |  {"device_id":"…","topic_prefix":"…","fw_version":"1.0.0"}
 |  subscribe status (notify)            |
 |  write ssid, write password           |
 |  write control = 0x01  -------------> |
 |  <---------------------- status       |  {"state":"connecting","reason":""}
 |                                       |  tries Wi-Fi for up to 20 s
 |  <---------------------- status       |  {"state":"connected","reason":""} → saved, reboots in ~1 s
 |                                  or   |  {"state":"failed","reason":"wifi_connect_failed"} → still advertising, retry
```

`status.state` values: `idle`, `connecting`, `connected`, `failed`. `reason` on failure:
`invalid_ssid`, `invalid_password`, `missing_ssid`, `wifi_connect_failed`.

After `connected` the board reboots, joins Wi-Fi, and connects to the broker. The dashboard
shows it online once its retained `status` message arrives (CLAUDE.md §4).

## Testing without the app

`tools/ble-provision-mock/provision.py` plays the app's role from a computer with Bluetooth:

```bash
uv run --with bleak tools/ble-provision-mock/provision.py --ssid "MyWifi" --password "secret"
# optional: --name "ESP32-O1" to pick a board when several are advertising
```

It scans for the service, pairs, prints `info`, writes the credentials, and streams `status`
notifications until `connected` or `failed`. Windows is the easiest host (WinRT handles Just
Works pairing on its own); on Linux, BlueZ may ask you to confirm pairing first.
