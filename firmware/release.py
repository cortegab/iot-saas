#!/usr/bin/env python3
"""Builds a firmware release: both boards, sizes checked, plus manifest.json.

    python3 release.py                 # -> ../infra/firmware/<version>/
    python3 release.py --dev           # also -> ../frontend/public/firmware/ (dev server)
    python3 release.py --skip-build    # package the last build only

The output is what the dashboard's browser flasher downloads. It isn't
committed (gitignored); the deploy step syncs infra/firmware/ to the VPS.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
BOARDS = {
    # board id: (PlatformIO env, chip name esptool reports, bootloader offset)
    "esp32": ("esp32", "ESP32", 0x1000),
    "esp32c3": ("esp32c3", "ESP32-C3", 0x0),
}
PARTITIONS_OFFSET = 0x8000
OTADATA_OFFSET = 0xE000
# Warn when an app fills this much of its OTA slot.
SIZE_WARN_RATIO = 0.9


def fail(msg: str) -> None:
    sys.exit(f"release: {msg}")


def read_version() -> str:
    match = re.search(r'#define FW_VERSION "([^"]+)"', (HERE / "src/version.h").read_text())
    if not match:
        fail("FW_VERSION not found in src/version.h")
    return match.group(1)


def read_partitions() -> dict[str, tuple[int, int]]:
    rows = (line for line in (HERE / "partitions.csv").read_text().splitlines() if line.strip() and not line.startswith("#"))
    out = {}
    for name, _type, _subtype, offset, size in (
        [cell.strip() for cell in row] for row in csv.reader(rows)
    ):
        out[name] = (int(offset, 0), int(size, 0))
    return out


def check_driver_ids(catalog: dict) -> None:
    """drivers.json and the firmware's registry must list the same ids."""
    registry = (HERE / "src/drivers/registry.cpp").read_text()
    registered = set(re.findall(r'\{"([a-z0-9_:]+)",\s*make\w+\}', registry))
    described = {d["id"] for d in catalog["drivers"]}
    if registered != described:
        fail(
            "drivers.json and src/drivers/registry.cpp disagree: "
            f"only in drivers.json {sorted(described - registered)}, "
            f"only in the registry {sorted(registered - described)}"
        )


def firmware_pins() -> dict[str, set[int]]:
    """Each chip's USABLE GPIOs, read from src/pins.cpp (the firmware's own rules)."""
    source = (HERE / "src/pins.cpp").read_text()
    c3, esp32 = re.search(r"#if CONFIG_IDF_TARGET_ESP32C3(.*?)#else(.*?)#endif", source, re.S).groups()  # type: ignore[union-attr]

    def usable(block: str) -> set[int]:
        match = re.search(r"USABLE\[\]\s*=\s*\{([^}]*)\}", block)
        if not match:
            fail("USABLE not found in src/pins.cpp")
        return {int(p) for p in match.group(1).split(",")}  # type: ignore[union-attr]

    return {"esp32c3": usable(c3), "esp32": usable(esp32)}


def check_board_models(models: list[dict]) -> None:
    """Every board model is built for (its chip has an env here), uses only
    pins the firmware accepts, and keeps its reset button and LED off them."""
    allowed = firmware_pins()
    ids = [m["id"] for m in models]
    if len(ids) != len(set(ids)):
        fail(f"boards.json has a duplicate id: {ids}")
    for m in models:
        if m["chip"] not in BOARDS:
            fail(f"boards.json: {m['id']} is for chip {m['chip']}, which has no build here")
        extra = set(m["pins"]) - allowed[m["chip"]]
        if extra:
            fail(f"boards.json: {m['id']} offers {sorted(extra)}, which src/pins.cpp refuses for {m['chip']}")
        for part in ("reset", "led"):
            if m[part]["pin"] in m["pins"]:
                fail(f"boards.json: {m['id']}'s {part} pin {m[part]['pin']} is also offered for wiring")
        i2c = m.get("i2c")
        if i2c and not {i2c["sda"], i2c["scl"]} <= set(m["pins"]):
            fail(f"boards.json: {m['id']}'s default I2C pins {i2c} aren't among its pins")


def check_esp32_bluetooth() -> None:
    """The ESP32 build's final sdkconfig must be NimBLE on a BLE-only controller:
    on the dual-mode default the board never advertises (platformio.ini)."""
    final = HERE / "sdkconfig.esp32"
    if not final.exists():
        fail("sdkconfig.esp32 not found (build the esp32 env first)")
    lines = set(final.read_text().splitlines())
    for needed in ("CONFIG_BT_NIMBLE_ENABLED=y", "CONFIG_BTDM_CTRL_MODE_BLE_ONLY=y"):
        if needed not in lines:
            fail(f"sdkconfig.esp32 lacks {needed}: BLE provisioning won't start. Check custom_sdkconfig in platformio.ini")


def boot_app0() -> Path:
    """The otadata image that boots app0, shipped with the Arduino framework."""
    packages = Path.home() / ".platformio/packages"
    for candidate in packages.glob("framework-arduinoespressif32*/tools/partitions/boot_app0.bin"):
        return candidate
    fail("boot_app0.bin not found under ~/.platformio/packages (build once first)")
    raise AssertionError


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dev", action="store_true", help="also copy into frontend/public/firmware/")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--out", type=Path, default=ROOT / "infra/firmware")
    args = parser.parse_args()

    version = read_version()
    catalog = json.loads((HERE / "drivers.json").read_text())
    check_driver_ids(catalog)
    models = json.loads((HERE / "boards.json").read_text())["models"]
    check_board_models(models)
    partitions = read_partitions()
    app_offset, app_size = partitions["app0"]
    cfg_offset, cfg_size = partitions["cfg"]
    nvs_offset, nvs_size = partitions["nvs"]

    if args.skip_build:
        print("note: --skip-build doesn't check the ESP32's Bluetooth config; a full build does")
    else:
        for env, _chip, _boot in BOARDS.values():
            subprocess.run(["pio", "run", "-e", env], cwd=HERE, check=True)
            # Checked at once: building another env deletes sdkconfig.esp32.
            if env == "esp32":
                check_esp32_bluetooth()

    out_dir = args.out / version
    if out_dir.exists():
        shutil.rmtree(out_dir)
    boards = {}
    for board, (env, chip, bootloader_offset) in BOARDS.items():
        build = HERE / ".pio/build" / env
        sources = [
            ("bootloader.bin", build / "bootloader.bin", bootloader_offset),
            ("partitions.bin", build / "partitions.bin", PARTITIONS_OFFSET),
            ("boot_app0.bin", boot_app0(), OTADATA_OFFSET),
            ("firmware.bin", build / "firmware.bin", app_offset),
        ]
        app_bytes = (build / "firmware.bin").stat().st_size
        if app_bytes > app_size:
            fail(f"{board}: firmware.bin is {app_bytes} bytes, over its {app_size}-byte OTA slot")
        used = app_bytes / app_size
        note = "  <-- over 90%, time to trim" if used > SIZE_WARN_RATIO else ""
        print(f"{board}: firmware.bin {app_bytes:,} bytes, {used:.0%} of the app slot{note}")

        parts = []
        (out_dir / board).mkdir(parents=True)
        for name, src, offset in sources:
            dest = out_dir / board / name
            shutil.copyfile(src, dest)
            parts.append({"path": f"{board}/{name}", "offset": offset, "size": dest.stat().st_size, "sha256": sha256(dest)})
        boards[board] = {
            "chip": chip,
            "parts": parts,
            "app": {"offset": app_offset, "size": app_size, "used": app_bytes},
            "cfg": {"offset": cfg_offset, "size": cfg_size},
            # Where saved Wi-Fi lives: a first-time install blanks it (0xFF is
            # an empty NVS), so a reused board starts at phone setup.
            "nvs": {"offset": nvs_offset, "size": nvs_size},
        }

    manifest = {
        "version": version,
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
        # One build per chip, keyed by chip...
        "boards": boards,
        # ...and the board models people pick, each pointing at its chip's build.
        "models": models,
        "drivers": catalog["drivers"],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (args.out / "latest.json").write_text(json.dumps({"version": version, "manifest": f"{version}/manifest.json"}) + "\n")
    print(f"release {version} -> {out_dir}")

    if args.dev:
        dev = ROOT / "frontend/public/firmware"
        if dev.exists():
            shutil.rmtree(dev)
        shutil.copytree(args.out, dev)
        print(f"copied to {dev}")


if __name__ == "__main__":
    main()
