"""The app calls the API cross-origin with an Authorization header, so every
call is preflighted unless the browser may cache the answer: 2 h, the most
Chrome keeps one (Starlette's default is 10 min)."""

import httpx

from app.config import settings


async def test_preflight_is_cacheable_for_two_hours(client: httpx.AsyncClient) -> None:
    origin = settings.cors_allow_origins_list[0]
    resp = await client.options(
        "/devices",
        headers={
            "origin": origin,
            "access-control-request-method": "GET",
            "access-control-request-headers": "authorization,x-tenant-id",
        },
    )
    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == origin
    assert resp.headers["access-control-max-age"] == "7200"
