"""Nightly pruning (prune_history, app.worker.pruning_loop): old rule
executions, commands and read or dismissed notifications go; recent ones and
unread notifications stay."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


async def test_prune_history_deletes_only_old_settled_rows(
    client: httpx.AsyncClient,
    app_session_factory: async_sessionmaker[AsyncSession],
    admin_session: AsyncSession,
) -> None:
    resp = await client.post(
        "/auth/register",
        json={"email": "prune@example.com", "password": "hunter2hunter2", "tenant_name": "Prune"},
    )
    body: dict[str, Any] = resp.json()
    tid = uuid.UUID(body["memberships"][0]["tenant_id"])
    headers = {"authorization": f"Bearer {body['access_token']}", "x-tenant-id": str(tid)}
    entry = (await client.get("/catalog", headers=headers)).json()[0]["id"]
    device = (
        await client.post(
            "/devices", json={"name": "b", "catalog_entry_id": entry}, headers=headers
        )
    ).json()["device"]["id"]
    old = datetime.now(UTC) - timedelta(days=120)
    new = datetime.now(UTC) - timedelta(days=1)
    for when in (old, new):
        await admin_session.execute(
            text(
                "INSERT INTO commands (id, tenant_id, device_id, actuator, value, issued_at, "
                "ttl_seconds, published_at, latency_ms) VALUES (gen_random_uuid(), :t, :d, 'fan', "
                "'true', :w, 30, :w, 1)"
            ),
            {"t": tid, "d": uuid.UUID(device), "w": when},
        )
        for read in (None, when):
            await admin_session.execute(
                text(
                    "INSERT INTO notifications (id, tenant_id, message, severity, kind, created_at, "
                    "read_at) VALUES (gen_random_uuid(), :t, 'm', 'warning', 'rule_fired', :w, :r)"
                ),
                {"t": tid, "w": when, "r": read},
            )
    await admin_session.commit()

    async with app_session_factory() as session, session.begin():
        row = (
            await session.execute(
                text("SELECT * FROM prune_history(:b)"),
                {"b": datetime.now(UTC) - timedelta(days=90)},
            )
        ).one()

    assert (row.rule_executions, row.commands, row.notifications) == (0, 1, 1)
    left = await admin_session.execute(
        text("SELECT count(*) FROM notifications WHERE read_at IS NULL")
    )
    assert left.scalar_one() == 2  # unread ones stay, old or not
