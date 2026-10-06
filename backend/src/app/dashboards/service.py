"""Dashboard CRUD. Every function takes tenant_id and user_id explicitly —
RLS enforces the tenant boundary, the user_id filter on top enforces that a
dashboard is personal (see dashboards/models.py's module docstring for why
that's app-layer, not a second RLS predicate).
"""

import uuid
from collections import Counter
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


async def count_widget_usage(
    session: AsyncSession, tenant_id: uuid.UUID, device_ids: list[uuid.UUID]
) -> tuple[Counter[str], int]:
    """Across every member's dashboards in the tenant: widgets per metric key
    on `device_ids`, and the number of actuator-control widgets on them. Only
    counts leave this function — never another member's dashboard content.
    """
    metric_widgets: Counter[str] = Counter()
    actuator_widgets = 0
    if not device_ids:
        return metric_widgets, actuator_widgets
    wanted = {str(d) for d in device_ids}
    result = await session.execute(select(Dashboard.layout).where(Dashboard.tenant_id == tenant_id))
    for layout in result.scalars().all():
        for widget in layout or []:
            if str(widget.get("device_id")) not in wanted:
                continue
            if widget.get("type") == "actuator_control":
                actuator_widgets += 1
            elif widget.get("metric"):
                metric_widgets[str(widget["metric"])] += 1
    return metric_widgets, actuator_widgets
