"""Sign in with Google (ease-of-use plan B5): checking a Google ID token.

The browser (Google Identity Services) or the Android app gets an ID token
from Google and posts it to /auth/google. It is trusted only once its RS256
signature checks out against Google's published keys, its audience is one of
our OAuth client ids, its issuer is Google, it hasn't expired and Google says
the email is verified. Google's keys are fetched (and cached) by PyJWKClient,
off the event loop.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import jwt

GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")

_jwks = jwt.PyJWKClient(GOOGLE_CERTS_URL, cache_keys=True, lifespan=3600)


class InvalidGoogleTokenError(Exception):
    pass


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    name: str | None


async def _google_signing_key(token: str) -> Any:
    try:
        return (await asyncio.to_thread(_jwks.get_signing_key_from_jwt, token)).key
    except jwt.PyJWKClientError as exc:
        raise InvalidGoogleTokenError(str(exc)) from exc


# Tests swap this for a local key (tests/integration/test_google_signin.py).
signing_key_for: Callable[[str], Awaitable[Any]] = _google_signing_key


async def verify_id_token(token: str, audiences: list[str]) -> GoogleIdentity:
    if not audiences:
        raise InvalidGoogleTokenError("Google sign-in is off")
    try:
        key = await signing_key_for(token)
        claims: dict[str, Any] = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=audiences,
            issuer=list(GOOGLE_ISSUERS),
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidGoogleTokenError(str(exc)) from exc
    email = claims.get("email")
    if not isinstance(email, str) or not email or claims.get("email_verified") is not True:
        raise InvalidGoogleTokenError("Google didn't confirm this email address")
    name = claims.get("name")
    return GoogleIdentity(
        sub=str(claims["sub"]),
        email=email.strip().lower(),
        name=name if isinstance(name, str) else None,
    )
