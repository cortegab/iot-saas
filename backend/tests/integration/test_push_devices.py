"""Push registrations and delivery against the real API and iot_test
Postgres: the API keeps a user to their own phones, RLS keeps workspaces
apart, and the sender reaches only current members who want the severity,
forgetting phones FCM reports gone."""

import uuid
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db import set_tenant_context
from app.notifications import service as notifications_service
from app.push import service as push_service
from app.push.fcm import SendResult
from app.push.sender import deliver

TOKEN_A = "fcm-token-" + "a" * 40
TOKEN_B = "fcm-token-" + "b" * 40


async def _register(client: httpx.AsyncClient, email: str, tenant_name: str) -> dict[str, Any]:
    resp = await client.post(
        "/auth/register",
        json={"email": email, "password": "hunter2hunter2", "tenant_name": tenant_name},
    )
    assert resp.status_code == 201
    body: dict[str, Any] = resp.json()
    return body


def _headers(body: dict[str, Any], tenant_id: str) -> dict[str, str]:
    return {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": tenant_id}


async def _workspace(client: httpx.AsyncClient, tag: str) -> tuple[dict[str, str], str]:
    owner = await _register(client, f"owner-{tag}@example.com", f"Push {tag}")
    tenant_id = owner["memberships"][0]["tenant_id"]
    return _headers(owner, tenant_id), tenant_id


async def test_register_update_and_unregister_own_phone(client: httpx.AsyncClient) -> None:
    headers, _ = await _workspace(client, "p1")
    first = await client.put(
        "/me/push-devices", json={"token": TOKEN_A, "platform": "android"}, headers=headers
    )
    assert first.status_code == 200
    phone = first.json()
    assert phone["min_severity"] == "warning" and phone["enabled"] is True

    # The same token again is the same phone (FCM hands the app its token on every start).
    again = await client.put(
        "/me/push-devices",
        json={"token": TOKEN_A, "platform": "android", "min_severity": "critical"},
        headers=headers,
    )
    assert again.json()["id"] == phone["id"] and again.json()["min_severity"] == "critical"

    off = await client.patch(
        f"/me/push-devices/{phone['id']}", json={"enabled": False}, headers=headers
    )
    assert off.json()["enabled"] is False

    gone = await client.delete(f"/me/push-devices/{phone['id']}", headers=headers)
    assert gone.status_code == 204
    assert (
        await client.delete(f"/me/push-devices/{phone['id']}", headers=headers)
    ).status_code == 404


async def test_nobody_else_touches_my_phone_and_workspaces_stay_apart(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    headers_a, tenant_a = await _workspace(client, "p2a")
    headers_b, tenant_b = await _workspace(client, "p2b")
    phone = (
        await client.put(
            "/me/push-devices", json={"token": TOKEN_A, "platform": "android"}, headers=headers_a
        )
    ).json()

    # Another workspace's member can't change or delete it.
    assert (
        await client.patch(
            f"/me/push-devices/{phone['id']}", json={"enabled": False}, headers=headers_b
        )
    ).status_code == 404
    assert (
        await client.delete(f"/me/push-devices/{phone['id']}", headers=headers_b)
    ).status_code == 404

    # RLS itself: workspace B's context sees none of A's rows.
    async with app_session_factory() as session, session.begin():
        await set_tenant_context(session, uuid.UUID(tenant_b))
        rows = (await session.execute(text("SELECT count(*) FROM push_devices"))).scalar_one()
        assert rows == 0
        await set_tenant_context(session, uuid.UUID(tenant_a))
        rows = (await session.execute(text("SELECT count(*) FROM push_devices"))).scalar_one()
        assert rows == 1


class FakeFcm:
    def __init__(self, gone: set[str]) -> None:
        self.gone = gone
        self.sent: list[dict[str, Any]] = []

    async def send(self, message: dict[str, Any]) -> SendResult:
        self.sent.append(message)
        return SendResult.GONE if message["token"] in self.gone else SendResult.SENT


async def test_sender_reaches_members_who_want_it_and_forgets_gone_phones(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
) -> None:
    headers, tenant_id = await _workspace(client, "p3")
    tid = uuid.UUID(tenant_id)
    await client.put(
        "/me/push-devices", json={"token": TOKEN_A, "platform": "android"}, headers=headers
    )
    critical_only = (
        await client.put(
            "/me/push-devices",
            json={"token": TOKEN_B, "platform": "android", "min_severity": "critical"},
            headers=headers,
        )
    ).json()

    # A phone of someone who isn't a member (left the workspace) never receives.
    stranger = uuid.uuid4()
    await admin_session.execute(
        text("INSERT INTO users (id, email, password_hash) VALUES (:id, 'left@example.com', 'x')"),
        {"id": stranger},
    )
    await admin_session.execute(
        text(
            "INSERT INTO push_devices (id, tenant_id, user_id, token, platform) "
            "VALUES (:id, :t, :u, 'fcm-token-stranger-xxxxxxxxxxxxxxxxxxxxxxxx', 'android')"
        ),
        {"id": uuid.uuid4(), "t": tid, "u": stranger},
    )
    await admin_session.commit()

    await notifications_service.create_notification(
        app_session_factory,
        tid,
        None,
        None,
        "temperature 31.2 > 30",
        severity="warning",
        kind="rule_fired",
    )
    async with app_session_factory() as session, session.begin():
        await set_tenant_context(session, tid)
        [warning] = await notifications_service.list_notifications(session, tid)

    fcm = FakeFcm(gone={TOKEN_A})
    reached = await deliver(app_session_factory, fcm, tid, warning.id)  # type: ignore[arg-type]
    # Only the "warnings and critical" phone wants a warning; it reported gone.
    assert [m["token"] for m in fcm.sent] == [TOKEN_A]
    assert reached == 0
    # Names only: the reading in the rule's message never leaves the platform.
    assert "31.2" not in str(fcm.sent[0])

    async with app_session_factory() as session, session.begin():
        await set_tenant_context(session, tid)
        left = await push_service.targets_for(session, tid, "critical")
    assert [t.id for t in left] == [uuid.UUID(critical_only["id"])]
