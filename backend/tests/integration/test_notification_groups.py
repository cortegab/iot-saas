"""Integration tests for the grouped notification feed: groups with ×N counts
over all of history, server-side filters and paging, the unread-by-type
summary, and the group actions (read, unread, dismiss with Undo) — against the
real FastAPI app and iot_test Postgres, under RLS.
"""

import uuid
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.notifications import service as notifications_service


async def _workspace(client: httpx.AsyncClient, tag: str) -> tuple[dict[str, str], str]:
    resp = await client.post(
        "/auth/register",
        json={
            "email": f"owner-{tag}@example.com",
            "password": "hunter2hunter2",
            "tenant_name": f"Groups {tag}",
        },
    )
    assert resp.status_code == 201
    body: dict[str, Any] = resp.json()
    tenant_id: str = body["memberships"][0]["tenant_id"]
    headers = {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": tenant_id}
    return headers, tenant_id


async def _seed(
    factory: async_sessionmaker[AsyncSession],
    tenant_id: str,
    message: str,
    times: int = 1,
    **kw: Any,
) -> None:
    for _ in range(times):
        await notifications_service.create_notification(
            factory, uuid.UUID(tenant_id), None, None, message, **kw
        )


async def _groups(
    client: httpx.AsyncClient, headers: dict[str, str], **params: Any
) -> tuple[list[dict[str, Any]], int]:
    resp = await client.get("/notifications/groups", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json(), int(resp.headers["x-total-count"])


async def test_repeats_group_with_counts_and_page(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    headers, tenant_id = await _workspace(client, "g1")
    await _seed(app_session_factory, tenant_id, "bay3 went offline", 3, kind="device_offline")
    await _seed(app_session_factory, tenant_id, "temp above 30", 2)
    await _seed(app_session_factory, tenant_id, "Fans updated", kind="template_changed")

    groups, total = await _groups(client, headers)
    assert total == 3
    # Most recently repeated first.
    assert [g["latest"]["message"] for g in groups] == [
        "Fans updated",
        "temp above 30",
        "bay3 went offline",
    ]
    assert [g["count"] for g in groups] == [1, 2, 3]
    assert groups[2]["unread_count"] == 3
    assert groups[2]["first_at"] <= groups[2]["last_at"]

    page2, total = await _groups(client, headers, limit=2, offset=2)
    assert total == 3
    assert [g["latest"]["message"] for g in page2] == ["bay3 went offline"]


async def test_filters_apply_on_the_server(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    headers, tenant_id = await _workspace(client, "g2")
    await _seed(
        app_session_factory,
        tenant_id,
        "bay3 went offline",
        2,
        kind="device_offline",
        severity="critical",
    )
    await _seed(app_session_factory, tenant_id, "temp above 30", severity="warning")
    await _seed(
        app_session_factory,
        tenant_id,
        "temp back to normal",
        kind="rule_cleared",
        severity="info",
        detail="Cooled by 100% fan",
    )

    # Fired and cleared are both "rules".
    groups, total = await _groups(client, headers, type="rules")
    assert total == 2
    _, total = await _groups(client, headers, type="device_offline")
    assert total == 1
    _, total = await _groups(client, headers, severity="critical")
    assert total == 1
    # Search covers the detail line, and % is a literal.
    groups, _ = await _groups(client, headers, q="100%")
    assert [g["latest"]["message"] for g in groups] == ["temp back to normal"]
    _, total = await _groups(client, headers, q="BAY3")
    assert total == 1

    # Unread: a group with anything unread.
    first = groups[0]["key"]
    assert (
        await client.post(f"/notifications/groups/{first}/read", headers=headers)
    ).status_code == 204
    _, total = await _groups(client, headers, unread="true")
    assert total == 2


async def test_summary_counts_unread_alerts_by_type(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    headers, tenant_id = await _workspace(client, "g3")
    await _seed(app_session_factory, tenant_id, "bay3 went offline", 4, kind="device_offline")
    await _seed(app_session_factory, tenant_id, "bay4 went offline", kind="device_offline")
    await _seed(app_session_factory, tenant_id, "temp above 30", 2)
    await _seed(app_session_factory, tenant_id, "temp normal", kind="rule_cleared")
    await _seed(app_session_factory, tenant_id, "Fans updated", kind="template_changed")

    groups, _ = await _groups(client, headers, type="template_changed")
    await client.post(f"/notifications/groups/{groups[0]['key']}/read", headers=headers)

    resp = await client.get("/notifications/summary", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    # Alerts, not notifications: bay3's four repeats count once.
    assert body["alerts"] == 5
    assert body["unread"] == 4
    assert body["unread_by_type"] == {
        "rules": 2,
        "rule_health": 0,
        "device_offline": 2,
        "delivery_failed": 0,
        "template_changed": 0,
    }


async def test_group_items_read_unread_dismiss_and_restore(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    headers, tenant_id = await _workspace(client, "g4")
    await _seed(app_session_factory, tenant_id, "bay3 went offline", 3, kind="device_offline")
    groups, _ = await _groups(client, headers)
    key = groups[0]["key"]

    items = await client.get(f"/notifications/groups/{key}/items?limit=2", headers=headers)
    assert items.status_code == 200
    assert len(items.json()) == 2
    assert items.headers["x-total-count"] == "3"

    await client.post(f"/notifications/groups/{key}/read", headers=headers)
    groups, _ = await _groups(client, headers)
    assert groups[0]["unread_count"] == 0

    # Unread puts back only the newest, so the group reads as unread.
    assert (
        await client.post(f"/notifications/groups/{key}/unread", headers=headers)
    ).status_code == 204
    groups, _ = await _groups(client, headers)
    assert groups[0]["unread_count"] == 1
    assert groups[0]["latest"]["read_at"] is None

    dismissed = await client.post(f"/notifications/groups/{key}/dismiss", headers=headers)
    assert dismissed.status_code == 200
    ids = dismissed.json()["ids"]
    assert len(ids) == 3
    _, total = await _groups(client, headers)
    assert total == 0

    restored = await client.post("/notifications/restore", headers=headers, json={"ids": ids})
    assert restored.status_code == 204
    groups, total = await _groups(client, headers)
    assert total == 1
    assert groups[0]["count"] == 3


async def test_group_routes_are_tenant_scoped(
    client: httpx.AsyncClient, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    a_headers, a_tenant = await _workspace(client, "g5a")
    b_headers, _ = await _workspace(client, "g5b")
    await _seed(app_session_factory, a_tenant, "bay3 went offline", 2, kind="device_offline")
    groups, _ = await _groups(client, a_headers)
    key = groups[0]["key"]

    # Another workspace sees nothing under the same key.
    resp = await client.post(f"/notifications/groups/{key}/dismiss", headers=b_headers)
    assert resp.status_code == 404
    items = await client.get(f"/notifications/groups/{key}/items", headers=b_headers)
    assert items.json() == []
    _, total = await _groups(client, b_headers)
    assert total == 0
    _, total = await _groups(client, a_headers)
    assert total == 1


async def test_malformed_group_key_is_404(client: httpx.AsyncClient) -> None:
    headers, _ = await _workspace(client, "g6")
    resp = await client.post("/notifications/groups/not-a-key/read", headers=headers)
    assert resp.status_code == 404
