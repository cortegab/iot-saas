"""Unit tests for app.rules.executors — the deferred webhook/email registry
and its retry loop. No DB, no network (httpx / the email provider are mocked).
"""

import uuid
from unittest.mock import AsyncMock

import httpx
import pytest

from app.config import Settings
from app.notifications import email as email_module
from app.rules import executors


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(executors, "_sleep", AsyncMock())


def _ctx() -> executors.ActionContext:
    return executors.ActionContext(tenant_id=uuid.uuid4(), rule_id=uuid.uuid4(), rule_name="R")


async def test_webhook_success_records_attempts(monkeypatch: pytest.MonkeyPatch) -> None:
    resp = AsyncMock()
    resp.status_code = 204
    monkeypatch.setattr(httpx.AsyncClient, "post", AsyncMock(return_value=resp))
    result = await executors.execute_with_retry("webhook", {"url": "https://x/h"}, _ctx())
    assert result.status == "success"
    assert result.detail["attempts"] == 1
    assert result.detail["status_code"] == 204


async def test_webhook_4xx_is_delivered_not_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    resp = AsyncMock()
    resp.status_code = 404
    post = AsyncMock(return_value=resp)
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    result = await executors.execute_with_retry("webhook", {"url": "https://x/h"}, _ctx())
    assert result.status == "success"  # delivered, endpoint rejected it
    assert post.await_count == 1


async def test_webhook_5xx_retries_then_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    resp = AsyncMock()
    resp.status_code = 502
    post = AsyncMock(return_value=resp)
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    result = await executors.execute_with_retry("webhook", {"url": "https://x/h"}, _ctx())
    assert result.status == "failed"
    assert result.detail["attempts"] == 4
    assert post.await_count == 4


async def test_webhook_connect_error_retries_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    ok = AsyncMock()
    ok.status_code = 200
    post = AsyncMock(side_effect=[httpx.ConnectError("x"), httpx.ConnectError("x"), ok])
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    result = await executors.execute_with_retry("webhook", {"url": "https://x/h"}, _ctx())
    assert result.status == "success"
    assert result.detail["attempts"] == 3


async def test_retry_config_override_caps_attempts(monkeypatch: pytest.MonkeyPatch) -> None:
    resp = AsyncMock()
    resp.status_code = 500
    post = AsyncMock(return_value=resp)
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    config = {"url": "https://x/h", "retry": {"max_attempts": 99}}  # clamped to 6
    result = await executors.execute_with_retry("webhook", config, _ctx())
    assert result.detail["attempts"] == 6
    assert post.await_count == 6


async def test_email_executor_sends_via_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[email_module.EmailMessage] = []

    class _P:
        async def send(self, msg: email_module.EmailMessage) -> None:
            sent.append(msg)

    monkeypatch.setattr(executors, "get_email_provider", lambda: _P())
    result = await executors.execute_with_retry(
        "email",
        {"to": ["a@x.com", "b@x.com"], "subject": "s", "body": "b"},
        _ctx(),
    )
    assert result.status == "success"
    assert result.detail == {"recipients_count": 2, "attempts": 1}
    assert sent[0].to == ["a@x.com", "b@x.com"]


async def test_email_provider_error_retried_then_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    class _P:
        async def send(self, msg: email_module.EmailMessage) -> None:
            raise RuntimeError("smtp down")

    monkeypatch.setattr(executors, "get_email_provider", lambda: _P())
    result = await executors.execute_with_retry(
        "email", {"to": ["a@x.com"], "subject": "s", "body": "b"}, _ctx()
    )
    assert result.status == "failed"
    assert result.detail["attempts"] == 4
    assert "smtp down" in result.detail["error"]


def test_default_email_provider_is_console(monkeypatch: pytest.MonkeyPatch) -> None:
    """The *code* default is console — isolated from whatever backend/.env(.local)
    happens to hold on this machine (a real EMAIL_PROVIDER=smtp for local dev,
    say), via _env_file=None bypassing env-file loading entirely."""
    monkeypatch.setattr(email_module, "settings", Settings(_env_file=None))
    email_module._provider = None
    assert isinstance(email_module.get_email_provider(), email_module.ConsoleEmailProvider)
    email_module._provider = None


def test_smtp_provider_requires_host() -> None:
    with pytest.raises(RuntimeError):
        email_module.SmtpEmailProvider(Settings(smtp_host=""))


async def test_smtp_provider_uses_implicit_tls_on_port_465(monkeypatch: pytest.MonkeyPatch) -> None:
    """Port 465 is implicit TLS from the first byte (Hostinger's published
    settings, among others) — passing start_tls against it is wrong (the
    server is already speaking TLS before a plaintext STARTTLS negotiation
    could happen)."""
    send = AsyncMock()
    monkeypatch.setattr(email_module.aiosmtplib, "send", send)
    provider = email_module.SmtpEmailProvider(
        Settings(smtp_host="smtp.hostinger.com", smtp_port=465, smtp_use_tls=True)
    )
    await provider.send(email_module.EmailMessage(to=["a@x.com"], subject="s", body="b"))
    assert send.call_args.kwargs["use_tls"] is True
    assert send.call_args.kwargs["start_tls"] is False


async def test_smtp_provider_uses_starttls_on_port_587(monkeypatch: pytest.MonkeyPatch) -> None:
    send = AsyncMock()
    monkeypatch.setattr(email_module.aiosmtplib, "send", send)
    provider = email_module.SmtpEmailProvider(
        Settings(smtp_host="smtp.example.com", smtp_port=587, smtp_use_tls=True)
    )
    await provider.send(email_module.EmailMessage(to=["a@x.com"], subject="s", body="b"))
    assert send.call_args.kwargs["use_tls"] is False
    assert send.call_args.kwargs["start_tls"] is True


def test_settings_email_provider_env_round_trips(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMAIL_PROVIDER", "smtp")
    assert Settings().email_provider == "smtp"
