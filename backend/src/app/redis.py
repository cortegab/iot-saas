"""Shared Redis client — a single module-level connection pool, analogous to
db.py's engine. Both the API (HTTP ingest fallback) and the worker (MQTT
ingest, the batched telemetry writer) import this rather than each opening
their own pool.
"""

import redis.asyncio as redis

from app.config import settings

redis_client: redis.Redis = redis.from_url(settings.redis_url, decode_responses=True)
