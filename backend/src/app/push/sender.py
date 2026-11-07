"""Push notifications for new alerts, off the hot path.

A worker loop listens on the realtime channels (realtime:<tenant>) for the
`notification` events notifications.service already publishes for live
updates, and sends each new alert to the phones that want its severity. Best
effort by design: a send never blocks or delays rule evaluation, and an alert
missed while the worker was down is still in the app's Alerts list.

The payload carries names only (rule, device), never readings or the rule's
own message text: FCM relays it through Google (docs/mobile-push.md).
"""

import asyncio
import json
import logging
import uuid
from typing import Any

import httpx
import redis.asyncio as redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.db import set_tenant_context
from app.devices import service as devices_service
from app.notifications import service as notifications_service
from app.push import service as push_service
from app.push.fcm import FcmClient, SendResult, ServiceAccount
from app.realtime.service import REALTIME_CHANNEL_PREFIX
from app.redis import redis_client
from app.rules import service as rules_service

log = logging.getLogger(__name__)

RECONNECT_SECONDS = 5
# Concurrent sends across all alerts; FCM is fast, phones are few.
MAX_IN_FLIGHT = 20


def compose(
    *,
    notification_id: uuid.UUID,
    tenant_id: uuid.UUID,
    kind: str,
    severity: str,
    device_id: uuid.UUID | None,
    rule_id: uuid.UUID | None,
    device_name: str | None,
    rule_name: str | None,
) -> dict[str, Any]:
    """The FCM message for one alert, without the token. Names only."""
    rule = rule_name or "A rule"
    device = device_name or "A device"
    titles = {
        "rule_fired": f"{rule} fired",
        "device_offline": f"{device} went offline",
        "rule_health": f"{rule} can't evaluate",
        "delivery_failed": f"A delivery failed for {rule}",
    }
    title = titles.get(kind, "New alert")
    body = (
        device_name if kind == "rule_fired" and device_name else "Open IO Driven for the details."
    )
    data = {
        "notification_id": str(notification_id),
        "tenant_id": str(tenant_id),
        "kind": kind,
        "severity": severity,
    }
    if device_id:
        data["device_id"] = str(device_id)
    if rule_id:
        data["rule_id"] = str(rule_id)
    return {
        "notification": {"title": title, "body": body},
        "data": data,
        "android": {
            "priority": "HIGH" if severity == "critical" else "NORMAL",
            "notification": {
                # The app creates this channel; one per severity lets the
                # phone's settings mute warnings but keep critical alerts.
                "channel_id": "critical" if severity == "critical" else "alerts",
                # Repeats of one alert replace each other on the phone.
                "tag": f"{kind}:{device_id or rule_id or notification_id}",
            },
        },
    }


async def deliver(
    factory: async_sessionmaker[AsyncSession],
    client: FcmClient,
    tenant_id: uuid.UUID,
    notification_id: uuid.UUID,
) -> int:
    """Sends one alert to its phones; returns how many it reached."""
    async with factory() as session, session.begin():
        await set_tenant_context(session, tenant_id)
        try:
            n = await notifications_service.get_notification(session, tenant_id, notification_id)
        except notifications_service.NotificationNotFoundError:
            return 0
        targets = await push_service.targets_for(session, tenant_id, n.severity)
        if not targets:
            return 0
        device_name = rule_name = None
        if n.device_id:
            try:
                device_name = (
                    await devices_service.get_device(session, tenant_id, n.device_id)
                ).name
            except devices_service.DeviceNotFoundError:
                pass
        if n.rule_id:
            try:
                rule_name = (await rules_service.get_rule(session, tenant_id, n.rule_id)).name
            except rules_service.RuleNotFoundError:
                pass
    message = compose(
        notification_id=n.id,
        tenant_id=tenant_id,
        kind=n.kind,
        severity=n.severity,
        device_id=n.device_id,
        rule_id=n.rule_id,
        device_name=device_name,
        rule_name=rule_name,
    )
    results = await asyncio.gather(
        *(client.send({**message, "token": t.token}) for t in targets), return_exceptions=True
    )
    gone = [t.id for t, r in zip(targets, results, strict=True) if r is SendResult.GONE]
    for r in results:
        if isinstance(r, BaseException):
            log.warning("push send error for tenant %s: %s", tenant_id, r)
    if gone:
        async with factory() as session, session.begin():
            await set_tenant_context(session, tenant_id)
            await push_service.forget_tokens(session, tenant_id, gone)
        log.info("forgot %d push registrations FCM reported gone", len(gone))
    return sum(1 for r in results if r is SendResult.SENT)


def _parse(message: dict[str, Any]) -> tuple[uuid.UUID, uuid.UUID] | None:
    """(tenant, notification) from a realtime pub/sub message, or None."""
    try:
        channel = str(message["channel"])
        event = json.loads(message["data"])
        if not isinstance(event, dict) or event.get("type") != "notification":
            return None
        return uuid.UUID(channel.removeprefix(REALTIME_CHANNEL_PREFIX)), uuid.UUID(str(event["id"]))
    except (KeyError, ValueError, TypeError):
        return None


async def push_loop(factory: async_sessionmaker[AsyncSession]) -> None:
    if not settings.fcm_service_account_file:
        log.info("push notifications off: FCM_SERVICE_ACCOUNT_FILE isn't set")
        return
    try:
        account = ServiceAccount.load(settings.fcm_service_account_file)
    except (OSError, ValueError, KeyError) as exc:
        log.error("push notifications off: can't read the FCM service account (%s)", exc)
        return
    log.info("push notifications on (Firebase project %s)", account.project_id)
    limit = asyncio.Semaphore(MAX_IN_FLIGHT)
    tasks: set[asyncio.Task[None]] = set()

    async def _run(client: FcmClient, tenant_id: uuid.UUID, notification_id: uuid.UUID) -> None:
        async with limit:
            try:
                await deliver(factory, client, tenant_id, notification_id)
            except Exception:
                log.exception("push for notification %s failed", notification_id)

    async with httpx.AsyncClient(timeout=10) as http:
        client = FcmClient(account, http)
        while True:
            try:
                async with redis_client.pubsub() as pubsub:
                    await pubsub.psubscribe(f"{REALTIME_CHANNEL_PREFIX}*")
                    async for message in pubsub.listen():
                        if message["type"] != "pmessage":
                            continue
                        parsed = _parse(message)
                        if parsed is None:
                            continue
                        task = asyncio.create_task(_run(client, *parsed))
                        tasks.add(task)
                        task.add_done_callback(tasks.discard)
            except redis.RedisError as exc:
                log.warning(
                    "push: realtime channel error (%s); reconnecting in %ss", exc, RECONNECT_SECONDS
                )
                await asyncio.sleep(RECONNECT_SECONDS)
