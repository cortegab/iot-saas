"""Public routes — no authentication. Thin per CLAUDE.md §6."""

from fastapi import APIRouter, HTTPException, Request, status

from app.contact import service
from app.contact.schemas import ContactRequest, ContactResponse
from app.shared.client_ip import client_ip

router = APIRouter(prefix="/public", tags=["public"])


def _client(request: Request) -> str:
    return client_ip(request)


@router.post("/contact", response_model=ContactResponse, status_code=status.HTTP_202_ACCEPTED)
async def contact(body: ContactRequest, request: Request) -> ContactResponse:
    """The landing page's contact form. Emails the team; stores nothing."""
    try:
        await service.submit(body, _client(request))
    except service.RateLimitedError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many messages from here. Try again in an hour, or email us directly.",
        ) from exc
    return ContactResponse(detail="Thanks. We'll reply within one working day.")
