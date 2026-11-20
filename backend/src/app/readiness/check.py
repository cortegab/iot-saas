"""`python -m app.readiness.check worker`: exit 0 when the worker's heartbeat
is fresh, 1 otherwise. The worker container's Docker healthcheck."""

import asyncio
import sys
import time

from app.readiness.service import HEARTBEAT_KEY, heartbeat_check
from app.redis import redis_client


async def _worker_ok() -> bool:
    raw = await redis_client.get(HEARTBEAT_KEY)
    check = heartbeat_check(raw.decode() if isinstance(raw, bytes) else raw, time.time())
    if not check.ok:
        print(check.detail, file=sys.stderr)
    return check.ok


if __name__ == "__main__":
    sys.exit(0 if asyncio.run(_worker_ok()) else 1)
