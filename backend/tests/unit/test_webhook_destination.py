"""A webhook can't reach this server's own network (server-side request
forgery): rules.executors.check_webhook_destination, with DNS stubbed."""

import pytest

from app.config import settings
from app.rules import executors
from app.rules.executors import ActionContext, BlockedDestinationError, check_webhook_destination


def _resolving_to(*addresses: str):  # type: ignore[no-untyped-def]
    async def resolve(host: str, port: int) -> list[str]:
        return list(addresses)

    return resolve


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.5",
        "172.18.0.3",
        "192.168.1.10",
        "169.254.169.254",
        "::1",
        "fd00::1",
        "0.0.0.0",
    ],
)
async def test_private_and_internal_addresses_are_refused(
    monkeypatch: pytest.MonkeyPatch, address: str
) -> None:
    monkeypatch.setattr(executors, "_resolve", _resolving_to(address))
    with pytest.raises(BlockedDestinationError):
        await check_webhook_destination("https://hooks.example.com/x")


async def test_a_host_with_one_private_address_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(executors, "_resolve", _resolving_to("93.184.216.34", "10.1.2.3"))
    with pytest.raises(BlockedDestinationError):
        await check_webhook_destination("https://hooks.example.com/x")


async def test_a_public_host_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(executors, "_resolve", _resolving_to("93.184.216.34"))
    await check_webhook_destination("https://hooks.example.com/x")


@pytest.mark.parametrize("url", ["ftp://example.com/x", "file:///etc/passwd", "https:///nohost"])
async def test_other_schemes_and_hostless_urls_are_refused(url: str) -> None:
    with pytest.raises(BlockedDestinationError):
        await check_webhook_destination(url)


async def test_a_blocked_webhook_fails_once_without_retrying(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "webhook_check_destination", True)
    monkeypatch.setattr(executors, "_resolve", _resolving_to("127.0.0.1"))
    calls = 0

    async def no_sleep(_: float) -> None:
        nonlocal calls
        calls += 1

    monkeypatch.setattr(executors, "_sleep", no_sleep)
    result = await executors.execute_with_retry(
        "webhook",
        {"url": "http://localhost:8000/admin"},
        ActionContext(tenant_id=None, rule_id=None, rule_name="r"),  # type: ignore[arg-type]
    )
    assert result.status == "failed"
    assert result.detail["blocked"] is True
    assert result.detail["attempts"] == 1
    assert calls == 0
