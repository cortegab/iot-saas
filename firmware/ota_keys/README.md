# Public update keys

The firmware accepts an over-the-air update only if its signature checks out against one of the
**public** keys here (ECDSA P-256 PEM, `*.pem`, at most two: the current key and the next one).
`ota_keys.py` builds them into the firmware.

Never put a private key here. Generating the key pair, where the private key lives and how to change
keys: `docs/firmware/ota.md`.
