"""GET /health/ready — for an external uptime monitor (infra/README.md).
/health stays the cheap liveness check the deploy uses."""

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.readiness import service
from app.redis import redis_client

router = APIRouter(tags=["health"])


@router.get("/health/ready")
async def ready(
    response: Response, session: AsyncSession = Depends(get_session, scope="function")
) -> dict[str, object]:
    """200 when the database, Redis, the worker and telemetry storage are all
    working; 503 with the failing check otherwise."""
    result = await service.readiness(session, redis_client)
    if result["status"] != "ok":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return result
