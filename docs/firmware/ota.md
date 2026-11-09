# Over-the-air firmware updates

From firmware **1.0.0**, a board running our generic firmware can update itself. An admin opens the
device → **Settings → Firmware** → **Update to …**. The board downloads the new release, checks it
and restarts into it. If the new version can't reach the broker within 2 minutes, the bootloader
goes back to the version it had.

Boards running 0.x need **one USB install of 1.0.0**. After that, updates come over the air.

## How it's kept safe

Every release is **signed**. The firmware only installs a file whose signature checks out against a
**public key built into it** (`firmware/ota_keys/*.pem`). The matching **private key** never goes
on the VPS. Someone who took over the server could change the files it serves, but couldn't sign
them, so the boards would refuse them.

| What | Where |
|---|---|
| Private signing key | GitHub Actions secret `OTA_SIGNING_KEY` in the protected `production` environment, plus an offline backup in two places |
| Public key | `firmware/ota_keys/` (committed; built into every board's firmware) |
| Signed releases | The VPS, served at `/firmware/` (`infra/firmware`) |
| Signature | In each release's `manifest.json`, per chip: `boards.<chip>.app.signature` |

The algorithm is **ECDSA P-256** over the SHA-256 of `firmware.bin` (DER, base64). The firmware
already links mbedTLS's ECDSA for Wi-Fi and TLS, so checking it costs no flash.

## One-time setup

Do these yourself: the private key must never pass through anyone else, Claude included.

1. **Protect the account and the branch.**
   - Turn on two-factor authentication on GitHub, with a passkey or a security key.
   - Protect the `prod` branch (Settings → Branches): no direct pushes, no force pushes.
   - In Settings → Environments → `production`, add yourself as a **required reviewer**, so every
     deploy waits for your approval.
2. **Make the key pair**, on your own computer:

   ```bash
   openssl ecparam -name prime256v1 -genkey -noout -out ota-signing-key.pem
   openssl ec -in ota-signing-key.pem -pubout -out key-1.pem
   ```

   `ota-signing-key.pem` is the **private** key. `key-1.pem` is the public key.
3. **Back up the private key** in two places, for example your password manager (as a secure note)
   and an encrypted USB stick. GitHub never shows a secret again once it's saved. Lose every copy
   and no board can be updated over the air until it's reinstalled over USB with a new key.
4. **Give the private key to GitHub.** Settings → Environments → `production` → Add secret: name
   `OTA_SIGNING_KEY`, value the whole contents of `ota-signing-key.pem` (the `BEGIN`/`END` lines
   too). Then delete the file from your Downloads or desktop. The backups are the only other copies.
5. **Commit the public key:** copy `key-1.pem` into `firmware/ota_keys/` and commit it.
6. **Install 1.0.0 over USB on each board** (Install on the device page), once.

From then on, `release.py` refuses to publish an unsigned release (`ota_keys/` has a key), and the
deploy signs each release with the secret.

## Releasing and updating

1. Bump `FW_VERSION` in `firmware/src/version.h` and merge to `prod` as usual.
2. The deploy's `firmware` job builds every chip, signs each `firmware.bin` and copies the release
   to the VPS. It fails if the secret's key matches none of `ota_keys/`.
3. On the device page: **Settings → Firmware** shows *Running 1.0.0 · Latest release 1.0.1 ·
   Update to 1.0.1…* (admins only, and only while the device is online).
4. The **Update** line follows it: *Downloading …*, *Restarting into …*, then *Updated to …*, or
   why it failed. A failed or rolled-back update also raises a **Device health** alert.

The request goes on `{tenant}/{device}/ota` at QoS 1 and isn't retained, so a device that is
offline doesn't install it later without anyone asking. The device page says the device must be
online.

## What the board does

1. It checks the request: version, URL, size, SHA-256, signature. A version it already runs is
   ignored.
2. It downloads into the other app slot, over HTTPS (Let's Encrypt root, same as MQTT) or plain
   HTTP on a bench, where the signature is what counts. It feeds the watchdog while it downloads.
3. It checks the size, the SHA-256 and the signature against each built-in public key. On any
   mismatch the slot is abandoned and the status says why, for example *the signature doesn't
   match this firmware's update keys*.
4. It restarts into the new version **on probation**. Once that version reaches the broker, it's
   kept. If it doesn't within 2 minutes, or can't use the board's config, the bootloader goes back
   to the previous version, and that one reports `rolled_back`.

Outputs go to their boot state during the restart, then follow the retained desired state as
usual.

## Changing the key

There are two public-key slots, so a key change is one ordinary update:

1. Make a new pair (step 2 above, `key-2.pem`), back it up, and add `key-2.pem` to
   `firmware/ota_keys/` next to `key-1.pem`.
2. Release and update every board. That release is still signed with the **old** key, which the
   boards trust.
3. Replace the `OTA_SIGNING_KEY` secret with the new private key, remove `key-1.pem`, and release
   again. From now on, releases are signed with the new key.

If the private key may have leaked, do the same right away. A leaked key is only useful to someone
who can also publish on your broker (MQTT credentials and ACLs) or serve your firmware files.

## Trying it on a bench

1. Make a **test** key pair (never the real one), put its public key in `firmware/ota_keys/`, and
   install that build over USB. Keep the test key out of commits.
2. Bump `FW_VERSION`, then `python3 firmware/release.py --dev --sign-key path/to/test-key.pem`.
3. In `backend/.env`, set `FIRMWARE_BASE_URL=http://<this computer's LAN address>:3000/firmware`,
   so the board can reach the dev server, and restart the API.
4. Device → Settings → Firmware → Update. Watch the board's serial log for `[OTA]` lines.
5. Before committing, put the real public key back.
