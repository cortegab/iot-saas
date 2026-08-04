"""Ingestion routes: the HTTP REST fallback and EMQX's HTTP auth/authz
callbacks. None of these use the normal Bearer-token/tenant-context
dependencies — callers are devices or EMQX itself, never a logged-in user.
"""

import base64
import binascii
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service as auth_service
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
        or not auth_service.verify_secret(password, record.token_hash)
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    return device_id, record


@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED)
async def ingest(
    body: IngestRequest,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    """HTTP REST ingest fallback (CLAUDE.md's device contract, §3's "HTTP REST
    ingest exists as a fallback"). Same device credentials as MQTT, same
    verification path (auth_service.verify_secret), same Redis stream as the
    MQTT ingest path — one normalization path, not two.
    """
    device_id, record = await _authenticate_device_basic(authorization, session)
    payload = TelemetryPayload(value=body.value, timestamp=body.timestamp)
    await ingestion_service.record_telemetry_direct(
        redis_client, record.tenant_id, device_id, body.metric, payload
    )
    return {"status": "accepted"}


@router.post(
    "/ingestion/emqx/authenticate",
    response_model=EmqxAuthenticateResponse,
    dependencies=[Depends(require_emqx_shared_secret)],
)
async def emqx_authenticate(
    body: EmqxAuthenticateRequest,
    session: AsyncSession = Depends(get_session),
) -> EmqxAuthenticateResponse:
    if body.username == settings.mqtt_worker_username:
        allowed = body.password == settings.mqtt_worker_password.get_secret_value()
        return EmqxAuthenticateResponse(result="allow" if allowed else "deny")

    try:
        device_id = uuid.UUID(body.username)
    except ValueError:
        return EmqxAuthenticateResponse(result="deny")

    record = await devices_service.lookup_device_for_auth(session, device_id)
    if (
        record is None
        or record.status != DeviceStatus.ACTIVE.value
        or not auth_service.verify_secret(body.password, record.token_hash)
    ):
        return EmqxAuthenticateResponse(result="deny")
    return EmqxAuthenticateResponse(result="allow")


def _is_cmd_or_state_topic(topic: str) -> bool:
    """{tenant}/{device}/cmd/{actuator} or {tenant}/{device}/state/{actuator}
    (CLAUDE.md §4) — the worker's own publish rights, for command dispatch.
    """
    parts = topic.split("/")
    return len(parts) == 4 and all(parts) and parts[2] in ("cmd", "state")


@router.post(
    "/ingestion/emqx/authorize",
    response_model=EmqxAuthorizeResponse,
    dependencies=[Depends(require_emqx_shared_secret)],
)
async def emqx_authorize(
    body: EmqxAuthorizeRequest,
    session: AsyncSession = Depends(get_session),
) -> EmqxAuthorizeResponse:
    if body.username == settings.mqtt_worker_username:
        # Subscribe across every tenant's telemetry + ack topics; publish only
        # to cmd/state (command dispatch, app/commands/service.py). Never
        # publish telemetry, never subscribe to cmd/state (it publishes those,
        # doesn't need to read them back).
        if body.action == "subscribe":
            allowed = body.topic in (
                ingestion_service.TELEMETRY_TOPIC_FILTER,
                ingestion_service.ACK_TOPIC_FILTER,
            )
        elif body.action == "publish":
            allowed = _is_cmd_or_state_topic(body.topic)
        else:
            allowed = False
        return EmqxAuthorizeResponse(result="allow" if allowed else "deny")

    try:
        device_id = uuid.UUID(body.username)
    except ValueError:
        return EmqxAuthorizeResponse(result="deny")

    record = await devices_service.lookup_device_for_auth(session, device_id)
    if record is None or record.status != DeviceStatus.ACTIVE.value:
        return EmqxAuthorizeResponse(result="deny")

    # Restrict each device to its own topic subtree (CLAUDE.md §4) — covers
    # telemetry, and cmd/state/ack.
    own_subtree = f"{record.tenant_slug}/{record.device_slug}/"
    allowed = body.topic.startswith(own_subtree)
    return EmqxAuthorizeResponse(result="allow" if allowed else "deny")
