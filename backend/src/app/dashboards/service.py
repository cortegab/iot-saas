"""Dashboard CRUD. Every function takes tenant_id and user_id explicitly —
RLS enforces the tenant boundary, the user_id filter on top enforces that a
dashboard is personal (see dashboards/models.py's module docstring for why
that's app-layer, not a second RLS predicate).
"""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dashboards.models import Dashboard


class DashboardNotFoundError(Exception):
    pass


async def create_dashboard(
    session: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, name: str
) -> Dashboard:
    dashboard = Dashboard(tenant_id=tenant_id, user_id=user_id, name=name, layout=[])
    session.add(dashboard)
    await session.flush()
    return dashboard


async def list_my_dashboards(
    session: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID
) -> list[Dashboard]:
    result = await session.execute(
        select(Dashboard)
        .where(Dashboard.tenant_id == tenant_id, Dashboard.user_id == user_id)
        .order_by(Dashboard.created_at)
    )
    return list(result.scalars().all())


async def get_dashboard(
    session: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, dashboard_id: uuid.UUID
) -> Dashboard:
    result = await session.execute(
        select(Dashboard).where(
            Dashboard.tenant_id == tenant_id,
            Dashboard.user_id == user_id,
            Dashboard.id == dashboard_id,
        )
    )
    dashboard = result.scalar_one_or_none()
    if dashboard is None:
        raise DashboardNotFoundError
    return dashboard


async def update_dashboard(
    dashboard: Dashboard, name: str | None, layout: list[dict[str, Any]] | None
) -> Dashboard:
    if name is not None:
        dashboard.name = name
    if layout is not None:
        dashboard.layout = layout
    return dashboard


async def delete_dashboard(session: AsyncSession, dashboard: Dashboard) -> None:
    await session.delete(dashboard)
