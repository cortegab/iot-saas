"""Public facts about the platform that clients need before signing in.

Thin per CLAUDE.md §6: values come straight from settings.
"""

from fastapi import APIRouter

from app.config import settings
from app.meta.schemas import ClientInfoResponse

router = APIRouter(prefix="/meta", tags=["meta"])


@router.get("/client", response_model=ClientInfoResponse)
async def client_info() -> ClientInfoResponse:
    """The oldest mobile app version the API still serves. The API changes
    additively, so this only rises when an old app would break."""
    return ClientInfoResponse(
        min_mobile_version=settings.min_mobile_version,
        latest_mobile_version=settings.latest_mobile_version,
        mobile_update_url=settings.mobile_update_url,
    )
