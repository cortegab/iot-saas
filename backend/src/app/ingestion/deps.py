"""Dependency-injection providers for ingestion routes."""

from fastapi import Header, HTTPException, status

from app.config import settings


async def require_emqx_shared_secret(
    x_emqx_auth_secret: str | None = Header(default=None),
) -> None:
    """EMQX's HTTP auth/authz callbacks are unauthenticated by nature (they
    verify OTHER credentials), so they need their own guard against arbitrary
    traffic reaching the api container: a shared secret only EMQX's mounted
    config and this app both know.
    """
    if x_emqx_auth_secret != settings.emqx_auth_shared_secret.get_secret_value():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing shared secret"
        )
