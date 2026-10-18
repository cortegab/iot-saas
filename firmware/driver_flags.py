# PlatformIO pre-build script (extra_scripts in platformio.ini): defines
# IOD_DRIVER_<ID> for each driver in drivers.json this build's chip carries.
# A driver without "chips" runs on every chip. src/drivers/registry.cpp
# compiles only the defined ones, so a build carries exactly the drivers
# the dashboard offers for its boards (release.py lists them per build).
import json
from pathlib import Path

Import("env")  # type: ignore[name-defined]  # noqa: F821

chip = env["PIOENV"]  # type: ignore[name-defined]  # noqa: F821
if chip != "native":
    drivers = json.loads((Path(env["PROJECT_DIR"]) / "drivers.json").read_text())["drivers"]  # type: ignore[name-defined]  # noqa: F821
    env.Append(  # type: ignore[name-defined]  # noqa: F821
        CPPDEFINES=[f"IOD_DRIVER_{d['id'].upper()}" for d in drivers if chip in d.get("chips", [chip])]
    )
