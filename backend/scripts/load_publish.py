"""Dev-only load generator for the live-updates path (docs/plans/web-realtime.md).

Feeds synthetic readings for N devices x R Hz through the same call the
worker makes once it has resolved a telemetry topic
(ingestion.service.record_telemetry_direct): onto the telemetry stream for
the batched writer, and onto the tenant's realtime channel for browsers.
MQTT/EMQX and rule evaluation are skipped on purpose — what's under load
here is what the browser receives, not the broker or the hot path.

Run inside the api container (it has the app code and the Redis/DB env):

    docker compose -f infra/docker-compose.yml exec -T api \\
      uv run python scripts/load_publish.py --tenant io-driven --prefix load- --count 20 --hz 20

Devices are addressed by slug; `--prefix load- --count 20` means load-01 ..
load-20 (what devices named "Load 01" .. "Load 20" slugify to — the
realtime-load Playwright probe creates exactly those).
"""

import argparse
import asyncio
import math
import os
import random
import sys
import threading
import time

from app.db import session_factory
from app.devices.service import DeviceDirectoryRecord
from app.ingestion import service as ingestion_service
from app.ingestion.schemas import TelemetryPayload
from app.redis import redis_client


async def _publish_device(
    device: DeviceDirectoryRecord,
    metric: str,
    hz: float,
    deadline: float,
    counter: list[int],
) -> None:
    period = 1 / hz
    phase = random.uniform(0, 2 * math.pi)
    next_at = time.monotonic()
    while next_at < deadline:
        t = time.monotonic()
        value = round(22 + 4 * math.sin(t / 20 + phase) + random.gauss(0, 0.3), 2)
        payload = TelemetryPayload(value=value)
        await ingestion_service.record_telemetry_direct(
            redis_client,
            device.tenant_id,
            device.device_id,
            metric,
            payload,
            ingestion_service.reading_time(payload),
        )
        counter[0] += 1
        next_at += period
        await asyncio.sleep(max(0.0, next_at - time.monotonic()))


async def _report(counter: list[int], deadline: float) -> None:
    last, last_at = 0, time.monotonic()
    while time.monotonic() < deadline:
        await asyncio.sleep(10)
        now = time.monotonic()
        print(f"{(counter[0] - last) / (now - last_at):.0f} msg/s ({counter[0]} total)", flush=True)
        last, last_at = counter[0], now


async def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--tenant", required=True, help="tenant slug")
    parser.add_argument("--prefix", default="load-")
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--metric", default="temperature")
    parser.add_argument("--hz", type=float, default=20)
    parser.add_argument("--minutes", type=float, default=30)
    parser.add_argument(
        "--exit-on-stdin-eof",
        action="store_true",
        help="stop when stdin closes — killing a `docker compose exec` client "
        "doesn't stop the process inside the container, but it does close stdin",
    )
    args = parser.parse_args()
    if args.exit_on_stdin_eof:
        threading.Thread(target=lambda: (sys.stdin.read(), os._exit(0)), daemon=True).start()

    devices: list[DeviceDirectoryRecord] = []
    for i in range(1, args.count + 1):
        slug = f"{args.prefix}{i:02d}"
        record = await ingestion_service.resolve_device_for_topic(
            session_factory, args.tenant, slug
        )
        if record is None:
            raise SystemExit(f"no device {args.tenant}/{slug}")
        devices.append(record)

    print(
        f"{len(devices)} devices x {args.hz} Hz on {args.metric} for {args.minutes} min", flush=True
    )
    deadline = time.monotonic() + args.minutes * 60
    counter = [0]
    await asyncio.gather(
        _report(counter, deadline),
        *(_publish_device(d, args.metric, args.hz, deadline, counter) for d in devices),
    )


if __name__ == "__main__":
    asyncio.run(main())
