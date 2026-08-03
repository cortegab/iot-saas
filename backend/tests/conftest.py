"""Shared pytest fixtures for the backend test suite.

Integration tests run against the real `iot_test` Postgres database (see the
one-time bootstrap documented in CLAUDE.md §8) — never a mock or an in-memory
substitute. Row-Level Security has no SQLite equivalent, and the whole point of
this phase's RLS tests is to prove the real Postgres policies, not a stand-in.
"""

from collections.abc import AsyncGenerator

import httpx
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

ADMIN_TEST_URL = "postgresql+asyncpg://iot:iot_dev_password@127.0.0.1:5432/iot_test"
APP_TEST_URL = "postgresql+asyncpg://iot_app:iot_app_dev_password@127.0.0.1:5432/iot_test"

# All app tables, in any order — TRUNCATE ... CASCADE handles FK dependencies
# regardless of the order they're listed in. Add one entry whenever a new
# table lands. Continuous aggregates (telemetry_1m/telemetry_1h) aren't listed
# here — they're materialized views, not plain tables, and can't be TRUNCATEd;
# tests that care about rollup contents refresh them explicitly instead.
ALL_TABLES = (
    "users",
    "tenants",
    "tenant_memberships",
    "refresh_tokens",
    "devices",
    "api_keys",
    "telemetry",
)


@pytest_asyncio.fixture
async def admin_engine() -> AsyncGenerator[AsyncEngine, None]:
    """Connects as `iot` (superuser) — bypasses RLS. Used for test setup/teardown
    and the explicit negative-control test proving that bypass is understood and
    scoped to migrations/tooling, never the running app.
    """
    engine = create_async_engine(ADMIN_TEST_URL)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def admin_session(admin_engine: AsyncEngine) -> AsyncGenerator[AsyncSession, None]:
    factory = async_sessionmaker(admin_engine, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest_asyncio.fixture
async def app_engine() -> AsyncGenerator[AsyncEngine, None]:
    """Connects as `iot_app` — the same non-superuser role the running API/worker
    use, so RLS policies apply exactly as they would to a real request.
    """
    engine = create_async_engine(APP_TEST_URL)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def app_session_factory(
    app_engine: AsyncEngine,
) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(app_engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def client(app_engine: AsyncEngine) -> AsyncGenerator[httpx.AsyncClient, None]:
    """An httpx.AsyncClient wired directly to the real FastAPI app (ASGI transport,
    no live server process), with app.db.get_session overridden to use the
    `iot_app`/iot_test engine instead of the dev database — mirroring get_session's
    real transaction-wrapping behavior exactly, just pointed at the test DB.
    """
    from app.db import get_session
    from app.main import app

    session_factory = async_sessionmaker(app_engine, expire_on_commit=False)

    async def override_get_session() -> AsyncGenerator[AsyncSession, None]:
        async with session_factory() as session, session.begin():
            yield session

    app.dependency_overrides[get_session] = override_get_session
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture(autouse=True)
async def clean_tables(admin_session: AsyncSession) -> AsyncGenerator[None, None]:
    """Truncate every app table after each test so tests never leak state into
    one another. Runs as `iot` specifically so the cleanup itself isn't subject
    to RLS.
    """
    yield
    await admin_session.execute(
        text(f"TRUNCATE TABLE {', '.join(ALL_TABLES)} RESTART IDENTITY CASCADE")
    )
    await admin_session.commit()
