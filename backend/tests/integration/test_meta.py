"""GET /meta/client: what the mobile app checks before anything else."""

import httpx
import pytest

from app.config import settings


async def test_client_info_is_public_and_comes_from_settings(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "min_mobile_version", "0.5.0")
    monkeypatch.setattr(settings, "latest_mobile_version", "0.6.1")
    resp = await client.get("/meta/client")
    assert resp.status_code == 200
    assert resp.json() == {
        "min_mobile_version": "0.5.0",
        "latest_mobile_version": "0.6.1",
        "mobile_update_url": settings.mobile_update_url,
    }
