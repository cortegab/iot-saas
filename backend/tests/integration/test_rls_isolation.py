"""Cross-tenant / cross-user isolation, proven against real Postgres RLS policies.

The tenant_memberships tests below were written early (Phase 1, while there were
only two tables), per PLAN.md's own advice. The devices tests at the bottom are
the milestone-defining suite for this phase: five assertions, each proving a
different layer, on a table using the *standard* single-tenant RLS predicate
(tenant_memberships uses a dual predicate instead — see its own tests above).
No mocking of set_config/current_setting anywhere in this file: every assertion
is a real query against a real RLS-enabled table.
"""

import uuid

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.tenants.models import TenantRole


async def _create_user(session: AsyncSession, email: str) -> uuid.UUID:
    user_id = uuid.uuid4()
    await session.execute(
        text("INSERT INTO users (id, email, password_hash) VALUES (:id, :email, 'x')"),
        {"id": user_id, "email": email},
    )
    return user_id


async def _create_tenant_with_owner(
    session: AsyncSession, name: str, owner_id: uuid.UUID
) -> uuid.UUID:
    tenant_id = uuid.uuid4()
    await session.execute(
        text("INSERT INTO tenants (id, name, slug) VALUES (:id, :name, :slug)"),
        {"id": tenant_id, "name": name, "slug": name.lower()},
    )
    await session.execute(
        text(
            "INSERT INTO tenant_memberships (id, tenant_id, user_id, role) "
            "VALUES (:id, :tenant_id, :user_id, :role)"
        ),
        {
            "id": uuid.uuid4(),
            "tenant_id": tenant_id,
            "user_id": owner_id,
            "role": TenantRole.OWNER.value,
        },
    )
    return tenant_id


async def test_negative_control_admin_bypasses_rls(
    admin_session: AsyncSession,
) -> None:
    """Confirms the admin (`iot`, superuser) connection genuinely bypasses RLS, so
    its scope of use — Alembic and test setup only, never the running app — is
    well understood, and "isolation" in the tests below isn't an accidental
    empty-result artifact.
    """
    async with admin_session.begin():
        user_a = await _create_user(admin_session, "a@example.com")
        user_b = await _create_user(admin_session, "b@example.com")
        await _create_tenant_with_owner(admin_session, "TenantA", user_a)
        await _create_tenant_with_owner(admin_session, "TenantB", user_b)

    async with admin_session.begin():
        rows = (await admin_session.execute(text("SELECT id FROM tenant_memberships"))).all()
    assert len(rows) == 2


async def test_fails_closed_with_no_context(
    admin_session: AsyncSession,
    app_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """`iot_app` with no session context set at all sees zero rows, even though
    rows exist — proves default-deny. Forgetting the tenant-context dependency
    must never leak everything.
    """
    async with admin_session.begin():
        user_a = await _create_user(admin_session, "a@example.com")
        await _create_tenant_with_owner(admin_session, "TenantA", user_a)

    async with app_session_factory() as session, session.begin():
        rows = (await session.execute(text("SELECT id FROM tenant_memberships"))).all()
    assert rows == []


async def test_membership_own_rows_visible_without_tenant_context(
    admin_session: AsyncSession,
    app_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """A user with only app.user_id set (no tenant selected yet — the state right
    after login) sees their own memberships across every tenant they belong to,
    and never another user's membership row. This is the dual-predicate policy's
    reason for existing.
    """
    async with admin_session.begin():
        user_a = await _create_user(admin_session, "a@example.com")
        user_b = await _create_user(admin_session, "b@example.com")
        await _create_tenant_with_owner(admin_session, "TenantA", user_a)
        await _create_tenant_with_owner(admin_session, "TenantB", user_b)

    async with app_session_factory() as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.user_id', :v, true)"), {"v": str(user_a)}
        )
        rows = (
            (await session.execute(text("SELECT user_id FROM tenant_memberships"))).scalars().all()
        )
    assert rows == [user_a]


async def test_membership_tenant_context_shows_all_members(
    admin_session: AsyncSession,
    app_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """With app.tenant_id set (the state once a tenant is selected), every member
    of that tenant is visible — the branch a team-management screen relies on.
    """
    async with admin_session.begin():
        user_a = await _create_user(admin_session, "a@example.com")
        user_b = await _create_user(admin_session, "b@example.com")
        tenant_a = await _create_tenant_with_owner(admin_session, "TenantA", user_a)
        await admin_session.execute(
            text(
                "INSERT INTO tenant_memberships (id, tenant_id, user_id, role) "
                "VALUES (:id, :tenant_id, :user_id, :role)"
            ),
            {
                "id": uuid.uuid4(),
                "tenant_id": tenant_a,
                "user_id": user_b,
                "role": TenantRole.VIEWER.value,
            },
        )

    async with app_session_factory() as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.tenant_id', :v, true)"), {"v": str(tenant_a)}
        )
        rows = (
            (await session.execute(text("SELECT user_id FROM tenant_memberships"))).scalars().all()
        )
    assert set(rows) == {user_a, user_b}


async def test_with_check_blocks_insert_outside_tenant_context(
    admin_session: AsyncSession,
    app_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """A raw INSERT for a tenant other than the one in context is rejected by the
    WITH CHECK clause — defense-in-depth against a hypothetical app-layer bug
    that computes the wrong tenant_id.
    """
    async with admin_session.begin():
        user_a = await _create_user(admin_session, "a@example.com")
        user_b = await _create_user(admin_session, "b@example.com")
        tenant_a = await _create_tenant_with_owner(admin_session, "TenantA", user_a)
        tenant_b = await _create_tenant_with_owner(admin_session, "TenantB", user_b)

    # The exception must propagate all the way out of session.begin() so its own
    # exception handling rolls back the aborted transaction — catching it earlier
    # and committing afterward would try to COMMIT an already-aborted transaction.
    async with app_session_factory() as session:
        with pytest.raises(DBAPIError):
            async with session.begin():
                await session.execute(
                    text("SELECT set_config('app.tenant_id', :v, true)"), {"v": str(tenant_a)}
                )
                await session.execute(
                    text(
                        "INSERT INTO tenant_memberships (id, tenant_id, user_id, role) "
                        "VALUES (:id, :tenant_id, :user_id, 'viewer')"
                    ),
                    {"id": uuid.uuid4(), "tenant_id": tenant_b, "user_id": user_a},
                )


# ── Devices: the milestone-defining suite (standard single-tenant predicate) ──


async def _create_catalog_entry(session: AsyncSession, tenant_id: uuid.UUID) -> uuid.UUID:
    entry_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO device_catalog_entries (id, tenant_id, name, metrics, actuators, is_legacy) "
            "VALUES (:id, :tenant_id, 'Test', '[]', '[]', false)"
        ),
        {"id": entry_id, "tenant_id": tenant_id},
    )
    return entry_id


async def _create_device(session: AsyncSession, tenant_id: uuid.UUID, slug: str) -> uuid.UUID:
    catalog_entry_id = await _create_catalog_entry(session, tenant_id)
    device_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO devices (id, tenant_id, catalog_entry_id, name, slug, token_hash, status) "
            "VALUES (:id, :tenant_id, :catalog_entry_id, :name, :slug, 'x', 'active')"
        ),
        {
            "id": device_id,
            "tenant_id": tenant_id,
            "catalog_entry_id": catalog_entry_id,
            "name": slug,
            "slug": slug,
        },
    )
    return device_id


async def _seed_two_tenants_with_devices(
    admin_session: AsyncSession,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    """Returns (tenant_a, tenant_b, device_a, device_b)."""
    async with admin_session.begin():
        user_a = await _create_user(admin_session, "a@example.com")
        user_b = await _create_user(admin_session, "b@example.com")
        tenant_a = await _create_tenant_with_owner(admin_session, "TenantA", user_a)
        tenant_b = await _create_tenant_with_owner(admin_session, "TenantB", user_b)
        device_a = await _create_device(admin_session, tenant_a, "sensor-a")
        device_b = await _create_device(admin_session, tenant_b, "sensor-b")
    return tenant_a, tenant_b, device_a, device_b


async def test_devices_negative_control_admin_bypasses_rls(admin_session: AsyncSession) -> None:
    """Confirms the admin (`iot`, superuser) connection genuinely bypasses RLS on
    devices too, so isolation below isn't an accidental empty-result artifact.
    """
    await _seed_two_tenants_with_devices(admin_session)
    async with admin_session.begin():
        rows = (await admin_session.execute(text("SELECT id FROM devices"))).all()
    assert len(rows) == 2


async def test_devices_fails_closed_with_no_tenant_context(
    admin_session: AsyncSession, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """`iot_app` with no tenant context set sees zero device rows, even though
    rows exist — forgetting the tenant-context dependency must never leak
    everything.
    """
    await _seed_two_tenants_with_devices(admin_session)
    async with app_session_factory() as session, session.begin():
        rows = (await session.execute(text("SELECT id FROM devices"))).all()
    assert rows == []


async def test_devices_rls_policy_blocks_cross_tenant_select_at_db_level(
    admin_session: AsyncSession, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """`iot_app` with set_tenant_context called directly (no HTTP layer at all)
    sees only its own tenant's device — proves the Postgres policy itself,
    independent of any app-level WHERE clause that might mask a broken policy.
    """
    tenant_a, _tenant_b, device_a, _device_b = await _seed_two_tenants_with_devices(admin_session)
    async with app_session_factory() as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.tenant_id', :v, true)"), {"v": str(tenant_a)}
        )
        rows = (await session.execute(text("SELECT id FROM devices"))).scalars().all()
    assert rows == [device_a]


async def test_devices_api_blocks_cross_tenant_read_end_to_end(
    client: httpx.AsyncClient,
) -> None:
    """Via the real FastAPI app: GET /devices as tenant A returns only A's
    device; GET /devices/{b_device_id} returns 404 — not 403, because the row
    is genuinely invisible under RLS, not merely forbidden by an app-level check.
    """
    reg_a = await client.post(
        "/auth/register",
        json={"email": "a@example.com", "password": "hunter2hunter2", "tenant_name": "TenantA"},
    )
    tenant_a = reg_a.json()["memberships"][0]["tenant_id"]
    headers_a = {"authorization": f"Bearer {reg_a.json()['access_token']}", "x-tenant-id": tenant_a}
    catalog_a = (await client.get("/catalog", headers=headers_a)).json()[0]["id"]
    device_a = (
        await client.post(
            "/devices", json={"name": "sensor-a", "catalog_entry_id": catalog_a}, headers=headers_a
        )
    ).json()

    reg_b = await client.post(
        "/auth/register",
        json={"email": "b@example.com", "password": "hunter2hunter2", "tenant_name": "TenantB"},
    )
    tenant_b = reg_b.json()["memberships"][0]["tenant_id"]
    headers_b = {"authorization": f"Bearer {reg_b.json()['access_token']}", "x-tenant-id": tenant_b}
    catalog_b = (await client.get("/catalog", headers=headers_b)).json()[0]["id"]
    device_b = (
        await client.post(
            "/devices", json={"name": "sensor-b", "catalog_entry_id": catalog_b}, headers=headers_b
        )
    ).json()

    listing = await client.get("/devices", headers=headers_a)
    assert listing.status_code == 200
    assert [d["id"] for d in listing.json()] == [device_a["device"]["id"]]

    cross_tenant_get = await client.get(f"/devices/{device_b['device']['id']}", headers=headers_a)
    assert cross_tenant_get.status_code == 404


async def test_devices_with_check_blocks_cross_tenant_insert(
    admin_session: AsyncSession, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """A raw INSERT into devices for a tenant other than the one in context is
    rejected by the WITH CHECK clause.
    """
    tenant_a, tenant_b, _device_a, _device_b = await _seed_two_tenants_with_devices(admin_session)

    async with admin_session.begin():
        catalog_entry_id = await _create_catalog_entry(admin_session, tenant_b)

    async with app_session_factory() as session:
        with pytest.raises(DBAPIError):
            async with session.begin():
                await session.execute(
                    text("SELECT set_config('app.tenant_id', :v, true)"), {"v": str(tenant_a)}
                )
                await session.execute(
                    text(
                        "INSERT INTO devices (id, tenant_id, catalog_entry_id, name, slug, token_hash, status) "
                        "VALUES (:id, :tenant_id, :catalog_entry_id, 'x', 'x', 'x', 'active')"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "tenant_id": tenant_b,
                        "catalog_entry_id": catalog_entry_id,
                    },
                )


# ── device_metric_health: same standard single-tenant predicate as devices ──


async def _create_metric_health_row(
    session: AsyncSession, tenant_id: uuid.UUID, device_id: uuid.UUID
) -> uuid.UUID:
    row_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO device_metric_health (id, tenant_id, device_id, metric, last_value, last_seen_at) "
            "VALUES (:id, :tenant_id, :device_id, 'temperature', 21.5, now())"
        ),
        {"id": row_id, "tenant_id": tenant_id, "device_id": device_id},
    )
    return row_id


async def test_device_metric_health_fails_closed_with_no_tenant_context(
    admin_session: AsyncSession, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    tenant_a, _tenant_b, device_a, _device_b = await _seed_two_tenants_with_devices(admin_session)
    async with admin_session.begin():
        await _create_metric_health_row(admin_session, tenant_a, device_a)

    async with app_session_factory() as session, session.begin():
        rows = (await session.execute(text("SELECT id FROM device_metric_health"))).all()
    assert rows == []


async def test_device_metric_health_rls_policy_blocks_cross_tenant_select(
    admin_session: AsyncSession, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    tenant_a, tenant_b, device_a, device_b = await _seed_two_tenants_with_devices(admin_session)
    async with admin_session.begin():
        row_a = await _create_metric_health_row(admin_session, tenant_a, device_a)
        await _create_metric_health_row(admin_session, tenant_b, device_b)

    async with app_session_factory() as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.tenant_id', :v, true)"), {"v": str(tenant_a)}
        )
        rows = (await session.execute(text("SELECT id FROM device_metric_health"))).scalars().all()
    assert rows == [row_a]


async def test_device_metric_health_with_check_blocks_cross_tenant_insert(
    admin_session: AsyncSession, app_session_factory: async_sessionmaker[AsyncSession]
) -> None:
    tenant_a, tenant_b, _device_a, device_b = await _seed_two_tenants_with_devices(admin_session)

    async with app_session_factory() as session:
        with pytest.raises(DBAPIError):
            async with session.begin():
                await session.execute(
                    text("SELECT set_config('app.tenant_id', :v, true)"), {"v": str(tenant_a)}
                )
                await session.execute(
                    text(
                        "INSERT INTO device_metric_health (id, tenant_id, device_id, metric) "
                        "VALUES (:id, :tenant_id, :device_id, 'temperature')"
                    ),
                    {"id": uuid.uuid4(), "tenant_id": tenant_b, "device_id": device_b},
                )
