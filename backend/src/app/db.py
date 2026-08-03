"""Async database engine, session, and Row-Level Security context helpers.

CLAUDE.md §7: the tenant-context dependency is what sets the RLS session variable;
never bypass it with a raw engine connection. This module is the only place that
constructs the runtime (`iot_app`) engine — every other module gets its session
through `get_session()`.
"""

import uuid
from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    pass


# Runtime engine only — connects as `iot_app` (NOSUPERUSER NOBYPASSRLS), never `iot`.
# Migrations use their own engine, constructed directly in alembic/env.py from
# settings.database_url (the admin `iot` role), not this one.
engine = create_async_engine(settings.app_database_url)

# Public — the worker process (no FastAPI request/Depends machinery) also needs
# to open its own short-lived sessions (device directory lookups, the batched
# telemetry writer), so this can't stay a get_session()-only implementation detail.
session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield a request-scoped session running inside a real transaction.

    Every request-serving DB session must run inside a transaction:
    set_user_context/set_tenant_context below use `set_config(..., is_local=true)`,
    which resets at COMMIT/ROLLBACK. Without a transaction wrapping the whole
    request, a session variable set on a pooled connection would leak into the
    next request that reuses that physical connection — a real cross-tenant leak
    via the pool, not a theoretical one.
    """
    async with session_factory() as session, session.begin():
        yield session


async def set_user_context(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Set app.user_id for the current transaction only.

    Set as soon as a request is authenticated, before any tenant is chosen —
    it's what lets tenant_memberships' RLS policy answer "which tenants am I a
    member of" without a tenant already in context.
    """
    await session.execute(
        text("SELECT set_config('app.user_id', :value, true)"), {"value": str(user_id)}
    )


async def set_tenant_context(session: AsyncSession, tenant_id: uuid.UUID) -> None:
    """Set app.tenant_id for the current transaction only.

    This is what every tenant-scoped table's RLS policy checks. Set by
    tenants.deps.require_tenant_context once X-Tenant-Id is validated against the
    caller's memberships — never call this without having verified membership first.
    """
    await session.execute(
        text("SELECT set_config('app.tenant_id', :value, true)"), {"value": str(tenant_id)}
    )
