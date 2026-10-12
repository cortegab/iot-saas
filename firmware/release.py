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
    partitions = read_partitions()
    app_offset, app_size = partitions["app0"]
    cfg_offset, cfg_size = partitions["cfg"]

    if not args.skip_build:
        envs = [arg for env, _chip, _boot in BOARDS.values() for arg in ("-e", env)]
        subprocess.run(["pio", "run", *envs], cwd=HERE, check=True)

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
        }

    manifest = {
        "version": version,
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "boards": boards,
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
