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
    # board id: (PlatformIO env, chip name esptool reports, bootloader offset).
    # The env is named after the board id: driver_flags.py relies on it.
    "esp32": ("esp32", "ESP32", 0x1000),
    "esp32c3": ("esp32c3", "ESP32-C3", 0x0),
    "esp32s3": ("esp32s3", "ESP32-S3", 0x0),
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
    """drivers.json and the firmware's registry must list the same ids, each
    registry entry behind its own IOD_DRIVER_<ID> (driver_flags.py), and a
    driver's `chips` must name chips built here."""
    registry = (HERE / "src/drivers/registry.cpp").read_text()
    registered = set(re.findall(r'\{"([a-z0-9_:]+)",\s*make\w+\}', registry))
    described = {d["id"] for d in catalog["drivers"]}
    if registered != described:
        fail(
            "drivers.json and src/drivers/registry.cpp disagree: "
            f"only in drivers.json {sorted(described - registered)}, "
            f"only in the registry {sorted(registered - described)}"
        )
    guarded = {
        driver for guard, driver in re.findall(r'#ifdef IOD_DRIVER_(\w+)\s*\{"([a-z0-9_:]+)"', registry) if guard == driver.upper()
    }
    if guarded != registered:
        fail(f"src/drivers/registry.cpp: put {sorted(registered - guarded)} behind their own #ifdef IOD_DRIVER_<ID>")
    for d in catalog["drivers"]:
        unknown = set(d.get("chips", [])) - set(BOARDS)
        if unknown:
            fail(f"drivers.json: {d['id']} names chips {sorted(unknown)}, which have no build here")


def drivers_for(catalog: dict, board: str) -> list[str]:
    """The driver ids a chip's build carries: the same rule as driver_flags.py."""
    return [d["id"] for d in catalog["drivers"] if board in d.get("chips", [board])]


def chip_blocks(path: str) -> dict[str, str]:
    """Each chip's block of an `#if CONFIG_IDF_TARGET_X … #elif … #else #error`
    chain in a firmware source, keyed by board id (ESP32C3 -> esp32c3)."""
    source = (HERE / path).read_text()
    parts = re.split(r"#(?:el)?if CONFIG_IDF_TARGET_(\w+)", source)
    blocks = {chip.lower(): re.split(r"#else|#endif", body)[0] for chip, body in zip(parts[1::2], parts[2::2])}
    if not blocks:
        fail(f"no CONFIG_IDF_TARGET_ blocks in {path}")
    return blocks


def pin_list(block: str, name: str, where: str) -> set[int]:
    match = re.search(rf"{name}\[\]\s*=\s*\{{([^}}]*)\}}", block)
    if not match:
        fail(f"{name} not found in {where}")
    return {int(p) for p in match.group(1).split(",") if int(p) >= 0}  # type: ignore[union-attr]


def firmware_pins() -> dict[str, dict[str, set[int]]]:
    """Each chip's pin rules, read from src/pins.cpp (the firmware's own)."""
    return {
        chip: {key: pin_list(block, name, f"src/pins.cpp ({chip})") for key, name in (("usable", "USABLE"), ("adc1", "ADC1"), ("inputOnly", "INPUT_ONLY"))}
        for chip, block in chip_blocks("src/pins.cpp").items()
    }


def check_chips(pins: dict[str, dict[str, set[int]]]) -> None:
    """Every build here has a block in board.h and pins.cpp, and the dashboard's
    CHIP_PINS (frontend/src/lib/hardware/board-pins.ts) says what pins.cpp says."""
    for board, (env, _chip, _boot) in BOARDS.items():
        if env != board:
            fail(f"release.py BOARDS: {board}'s PlatformIO env must be named {board} (driver_flags.py keys on it)")
    for path, chips in (("src/board.h", set(chip_blocks("src/board.h"))), ("src/pins.cpp", set(pins))):
        if chips != set(BOARDS):
            fail(f"{path} has blocks for {sorted(chips)}, but release.py builds {sorted(BOARDS)}")
    source = (ROOT / "frontend/src/lib/hardware/board-pins.ts").read_text()
    for chip, rules in pins.items():
        match = re.search(rf"\b{chip}:\s*\{{(.*?)\}}", source, re.S)
        if not match:
            fail(f"board-pins.ts CHIP_PINS has no {chip}")
        for key, expected in rules.items():
            listed = re.search(rf"{key}:\s*\[([^\]]*)\]", match.group(1))  # type: ignore[union-attr]
            got = {int(p) for p in listed.group(1).split(",") if p.strip()} if listed else None
            if got != expected:
                fail(f"board-pins.ts CHIP_PINS.{chip}.{key} is {sorted(got or [])}, src/pins.cpp says {sorted(expected)}")


LED_TYPES = {"gpio", "rgb", "none"}
CAPABILITIES = {"ble", "rgb_led"}


def check_board_models(models: list[dict], pins: dict[str, dict[str, set[int]]]) -> None:
    """Every board model is built for (its chip has an env here), uses only
    pins the firmware accepts, keeps its reset button and LED off them, and
    says what it can do (capabilities) consistently with its LED."""
    ids = [m["id"] for m in models]
    if len(ids) != len(set(ids)):
        fail(f"boards.json has a duplicate id: {ids}")
    for m in models:
        if m["chip"] not in BOARDS:
            fail(f"boards.json: {m['id']} is for chip {m['chip']}, which has no build here")
        extra = set(m["pins"]) - pins[m["chip"]]["usable"]
        if extra:
            fail(f"boards.json: {m['id']} offers {sorted(extra)}, which src/pins.cpp refuses for {m['chip']}")
        led_type = m["led"].get("type", "gpio")
        if led_type not in LED_TYPES:
            fail(f"boards.json: {m['id']}'s led.type {led_type!r} isn't one of {sorted(LED_TYPES)}")
        caps = set(m.get("capabilities", []))
        if caps - CAPABILITIES:
            fail(f"boards.json: {m['id']} has unknown capabilities {sorted(caps - CAPABILITIES)}")
        if ("rgb_led" in caps) != (led_type == "rgb"):
            fail(f"boards.json: {m['id']} lists rgb_led only when its led.type is rgb")
        for part in ("reset", "led"):
            if part == "led" and led_type == "none":
                continue
            if m[part]["pin"] in m["pins"]:
                fail(f"boards.json: {m['id']}'s {part} pin {m[part]['pin']} is also offered for wiring")
        i2c = m.get("i2c")
        if i2c and not {i2c["sda"], i2c["scl"]} <= set(m["pins"]):
            fail(f"boards.json: {m['id']}'s default I2C pins {i2c} aren't among its pins")


def check_esp32_bluetooth() -> None:
    """The ESP32 build's final sdkconfig must be NimBLE on a BLE-only controller
    with normal-priority interrupts: on the dual-mode default the board never
    advertises, and with the high-level one it hangs at boot (platformio.ini)."""
    final = HERE / "sdkconfig.esp32"
    if not final.exists():
        fail("sdkconfig.esp32 not found (build the esp32 env first)")
    lines = set(final.read_text().splitlines())
    for needed in ("CONFIG_BT_NIMBLE_ENABLED=y", "CONFIG_BTDM_CTRL_MODE_BLE_ONLY=y"):
        if needed not in lines:
            fail(f"sdkconfig.esp32 lacks {needed}: BLE provisioning won't start. Check custom_sdkconfig in platformio.ini")
    if "CONFIG_BTDM_CTRL_HLI=y" in lines:
        fail("sdkconfig.esp32 has CONFIG_BTDM_CTRL_HLI=y: the board hangs at boot. Check custom_sdkconfig in platformio.ini")


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
    pins = firmware_pins()
    check_chips(pins)
    check_board_models(models, pins)
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
            # What this build carries (drivers.json "chips"); the dashboard
            # offers a board only these.
            "drivers": drivers_for(catalog, board),
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
