"""Ingestion routes: the HTTP REST fallback and EMQX's HTTP auth/authz
callbacks. None of these use the normal Bearer-token/tenant-context
dependencies — callers are devices or EMQX itself, never a logged-in user.
"""

import base64
import binascii
import hmac
import json
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service as auth_service
from app.catalog.schemas import RESERVED_METRIC_KEYS
from app.config import settings
from app.db import get_session
from app.devices import service as devices_service
from app.devices.models import DeviceStatus
from app.ingestion import service as ingestion_service
from app.ingestion.deps import require_emqx_shared_secret
from app.ingestion.schemas import (
    EmqxAuthenticateRequest,
    EmqxAuthenticateResponse,
    EmqxAuthorizeRequest,
    EmqxAuthorizeResponse,
    IngestRequest,
    TelemetryPayload,
)
from app.redis import redis_client

router = APIRouter(tags=["ingestion"])


async def _authenticate_device_basic(
    authorization: str | None, session: AsyncSession
) -> tuple[uuid.UUID, devices_service.DeviceAuthRecord]:
    if authorization is None or not authorization.startswith("Basic "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing device credentials")

    try:
        decoded = base64.b64decode(authorization.removeprefix("Basic ")).decode()
        username, _, password = decoded.partition(":")
        device_id = uuid.UUID(username)
    except (binascii.Error, ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials") from exc

    record = await devices_service.lookup_device_for_auth(session, device_id)
    if (
        record is None
        or record.status != DeviceStatus.ACTIVE.value
        or not await auth_service.verify_secret_off_loop(password, record.token_hash)
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    return device_id, record


@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED)
async def ingest(
    body: IngestRequest,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> dict[str, str]:
    """HTTP REST ingest fallback (CLAUDE.md's device contract, §3's "HTTP REST
    ingest exists as a fallback"). Same device credentials as MQTT, same
    verification path (auth_service.verify_secret), same Redis stream as the
    MQTT ingest path — one normalization path, not two.
    """
    device_id, record = await _authenticate_device_basic(authorization, session)
    if body.metric.strip().lower() in RESERVED_METRIC_KEYS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{body.metric!r} is reserved for the platform; send it on MQTT.",
        )
    if not ingestion_service.allow_http_reading(device_id):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"At most {ingestion_service.HTTP_INGEST_PER_MINUTE} readings a minute per device.",
            headers={"Retry-After": "60"},
        )
    payload = TelemetryPayload(value=body.value, timestamp=body.timestamp)
    received_at = ingestion_service.reading_time(payload)
    # Rules first (in the worker, which holds them), then storage, the same
    # order as an MQTT reading.
    await redis_client.publish(
        ingestion_service.HTTP_READING_CHANNEL,
        json.dumps(
            {
                "tenant_id": str(record.tenant_id),
                "device_id": str(device_id),
                "tenant_slug": record.tenant_slug,
                "device_slug": record.device_slug,
                "metric": body.metric,
                "value": body.value,
                "timestamp": received_at.timestamp(),
            }
        ),
    )
    await ingestion_service.record_telemetry_direct(
        redis_client, record.tenant_id, device_id, body.metric, payload, received_at
    )
    return {"status": "accepted"}


@router.post(
    "/ingestion/emqx/authenticate",
    response_model=EmqxAuthenticateResponse,
    dependencies=[Depends(require_emqx_shared_secret)],
)
async def emqx_authenticate(
    body: EmqxAuthenticateRequest,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> EmqxAuthenticateResponse:
    if body.username == settings.mqtt_worker_username:
        allowed = hmac.compare_digest(
            body.password.encode(), settings.mqtt_worker_password.get_secret_value().encode()
        )
        return EmqxAuthenticateResponse(result="allow" if allowed else "deny")
    if body.username == settings.mqtt_simulator_username:
        allowed = settings.simulator_enabled and hmac.compare_digest(
            body.password.encode(), settings.mqtt_simulator_password.get_secret_value().encode()
        )
        return EmqxAuthenticateResponse(result="allow" if allowed else "deny")

    try:
        device_id = uuid.UUID(body.username)
    except ValueError:
        return EmqxAuthenticateResponse(result="deny")

    record = await devices_service.lookup_device_for_auth(session, device_id)
    if (
        record is None
        or record.status != DeviceStatus.ACTIVE.value
        or not await auth_service.verify_secret_off_loop(body.password, record.token_hash)
    ):
        return EmqxAuthenticateResponse(result="deny")
    return EmqxAuthenticateResponse(result="allow")


def _is_device_publish_topic(topic: str, own_subtree: str) -> bool:
    """What a device may publish (CLAUDE.md §4), by direction: its telemetry
    and `status` ({tenant}/{device}/{metric}) and its acks
    ({tenant}/{device}/ack/{actuator}). Never what the platform sends it
    (cmd, state, config, ota): the device credential is also the BLE
    provisioning PoP printed in a QR, so it must not be able to switch its own
    outputs or push its own update."""
    if not topic.startswith(own_subtree):
        return False
    rest = topic[len(own_subtree) :].split("/")
    if not all(rest):
        return False
    if len(rest) == 1:
        return rest[0] not in ingestion_service.PLATFORM_TO_DEVICE_SEGMENTS
    return len(rest) == 2 and rest[0] == "ack"


def _simulator_topic(topic: str, action: str) -> tuple[str, str] | None:
    """The {tenant}/{device} a simulator request is for, when its shape is one
    the simulator may use (ease-of-use B4): publish a reading or status
    ({tenant}/{device}/{metric}) or an ack ({tenant}/{device}/ack/{actuator});
    subscribe to {tenant}/{device}/cmd/+ and .../state/+. The caller checks the
    device is a simulated one."""
    parts = topic.split("/")
    if len(parts) < 3 or not all(parts[:2]):
        return None
    if action == "publish":
        rest = parts[2:]
        if not all(rest):
            return None
        ok = (len(rest) == 1 and rest[0] not in ingestion_service.PLATFORM_TO_DEVICE_SEGMENTS) or (
            len(rest) == 2 and rest[0] == "ack"
        )
    elif action == "subscribe":
        ok = len(parts) == 4 and parts[2] in ("cmd", "state") and parts[3] == "+"
    else:
        ok = False
    return (parts[0], parts[1]) if ok else None


def _is_worker_publish_topic(topic: str) -> bool:
    """The worker's own publish rights (CLAUDE.md §4):
    {tenant}/{device}/cmd/{actuator} and .../state/{actuator} for command
    dispatch, the retained {tenant}/{device}/config telemetry profile, and
    {tenant}/{device}/ota update requests (app.firmware)."""
    parts = topic.split("/")
    if not all(parts):
        return False
    if len(parts) == 4:
        return parts[2] in ("cmd", "state")
    return len(parts) == 3 and parts[2] in ("config", "ota")


@router.post(
    "/ingestion/emqx/authorize",
    response_model=EmqxAuthorizeResponse,
    dependencies=[Depends(require_emqx_shared_secret)],
)
async def emqx_authorize(
    body: EmqxAuthorizeRequest,
    session: AsyncSession = Depends(get_session, scope="function"),
) -> EmqxAuthorizeResponse:
    if body.username == settings.mqtt_worker_username:
        # Subscribe across every tenant's telemetry + ack topics; publish only
        # to cmd/state (command dispatch, app/commands/service.py) and config
        # (app/worker.py's _handle_config_publish). Never publish telemetry,
        # never subscribe to what it publishes.
        if body.action == "subscribe":
            allowed = body.topic in (
                ingestion_service.TELEMETRY_TOPIC_FILTER,
                ingestion_service.ACK_TOPIC_FILTER,
            )
        elif body.action == "publish":
            allowed = _is_worker_publish_topic(body.topic)
        else:
            allowed = False
        return EmqxAuthorizeResponse(result="allow" if allowed else "deny")

    if body.username == settings.mqtt_simulator_username:
        # Only simulated devices' own topics, never a real board's (CLAUDE.md §4).
        target = _simulator_topic(body.topic, body.action) if settings.simulator_enabled else None
        allowed = target is not None and await devices_service.is_simulated_device(session, *target)
        return EmqxAuthorizeResponse(result="allow" if allowed else "deny")

    try:
        device_id = uuid.UUID(body.username)
    except ValueError:
        return EmqxAuthorizeResponse(result="deny")

    record = await devices_service.lookup_device_for_auth(session, device_id)
    if record is None or record.status != DeviceStatus.ACTIVE.value:
        return EmqxAuthorizeResponse(result="deny")

    # Each device stays in its own topic subtree (CLAUDE.md §4). It may read
    # anything there (its cmd, state, config and ota), and publish only what
    # flows device -> platform.
    own_subtree = f"{record.tenant_slug}/{record.device_slug}/"
    if body.action == "publish":
        allowed = _is_device_publish_topic(body.topic, own_subtree)
    else:
        allowed = body.topic.startswith(own_subtree)
    return EmqxAuthorizeResponse(result="allow" if allowed else "deny")
