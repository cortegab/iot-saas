"""Dashboard routes: CRUD for personal, composable dashboards.

Thin per CLAUDE.md §6 — validation and delegation only, business logic lives
in dashboards/service.py. No admin gate on any route: a dashboard is a
personal utility view, not tenant configuration, so tenant membership alone
(require_tenant_context) is enough.
"""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.models import User
from app.dashboards import service
from app.dashboards.deps import get_dashboard_or_404
from app.dashboards.models import Dashboard
from app.dashboards.schemas import (
    DashboardCreateRequest,
    DashboardResponse,
    DashboardUpdateRequest,
    Widget,
)
from app.db import get_session
from app.tenants.deps import TenantContext, require_tenant_context

router = APIRouter(prefix="/dashboards", tags=["dashboards"])


def _to_response(dashboard: Dashboard, default_id: uuid.UUID | None) -> DashboardResponse:
    return DashboardResponse(
        id=dashboard.id,
        name=dashboard.name,
        layout=[Widget.model_validate(w) for w in dashboard.layout],
        is_default=dashboard.id == default_id,
        created_at=dashboard.created_at,
        updated_at=dashboard.updated_at,
    )


@router.get("", response_model=list[DashboardResponse])
async def list_dashboards(
    ctx: TenantContext = Depends(require_tenant_context),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> list[DashboardResponse]:
    dashboards = await service.list_my_dashboards(session, ctx.tenant_id, current_user.id)
    default_id = await service.get_default_dashboard_id(session, ctx.tenant_id, current_user.id)
    return [_to_response(d, default_id) for d in dashboards]


@router.post("", response_model=DashboardResponse, status_code=status.HTTP_201_CREATED)
async def create_dashboard(
    body: DashboardCreateRequest,
    ctx: TenantContext = Depends(require_tenant_context),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> DashboardResponse:
    dashboard = await service.create_dashboard(session, ctx.tenant_id, current_user.id, body.name)
    return _to_response(dashboard, None)


async def _default_id(session: AsyncSession, dashboard: Dashboard) -> uuid.UUID | None:
    return await service.get_default_dashboard_id(session, dashboard.tenant_id, dashboard.user_id)


@router.get("/{dashboard_id}", response_model=DashboardResponse)
async def get_dashboard(
    dashboard: Dashboard = Depends(get_dashboard_or_404),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> DashboardResponse:
    return _to_response(dashboard, await _default_id(session, dashboard))


@router.patch("/{dashboard_id}", response_model=DashboardResponse)
async def update_dashboard(
    body: DashboardUpdateRequest,
    dashboard: Dashboard = Depends(get_dashboard_or_404),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> DashboardResponse:
    layout = [w.model_dump(mode="json") for w in body.layout] if body.layout is not None else None
    updated = await service.update_dashboard(dashboard, body.name, layout)
    await session.flush()
    # updated_at is server-computed (onupdate=func.now()), so the flush above
    # marks it expired; refresh explicitly rather than letting a bare
    # attribute access trigger an implicit (and, in async SQLAlchemy,
    # unsupported) lazy load.
    await session.refresh(updated)
    return _to_response(updated, await _default_id(session, updated))


@router.put("/{dashboard_id}/default", status_code=status.HTTP_204_NO_CONTENT)
async def set_default(
    dashboard: Dashboard = Depends(get_dashboard_or_404),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> None:
    """Land here after signing in; replaces any earlier default."""
    await service.set_default(session, dashboard.tenant_id, dashboard.user_id, dashboard)


@router.delete("/{dashboard_id}/default", status_code=status.HTTP_204_NO_CONTENT)
async def clear_default(
    dashboard: Dashboard = Depends(get_dashboard_or_404),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> None:
    """Stop landing here, if it was the default."""
    if await _default_id(session, dashboard) == dashboard.id:
        await service.set_default(session, dashboard.tenant_id, dashboard.user_id, None)


@router.delete("/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dashboard(
    dashboard: Dashboard = Depends(get_dashboard_or_404),
    session: AsyncSession = Depends(get_session, scope="function"),
) -> None:
    await service.delete_dashboard(session, dashboard)
