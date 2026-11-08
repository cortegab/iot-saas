"""Push notifications: who receives what, the message (names only), and how
FCM's replies are read."""

import uuid

import httpx
import pytest

from app.push.fcm import FcmClient, SendResult, ServiceAccount, classify
from app.push.sender import _parse, compose
from app.push.service import receives

T = uuid.UUID("11111111-1111-1111-1111-111111111111")
N = uuid.UUID("22222222-2222-2222-2222-222222222222")
D = uuid.UUID("33333333-3333-3333-3333-333333333333")


def test_severity_settings() -> None:
    assert receives("critical", "critical")
    assert not receives("critical", "warning")
    assert receives("warning", "warning") and receives("warning", "critical")
    assert not receives("warning", "info") and not receives("critical", "info")


def test_message_carries_names_never_readings() -> None:
    m = compose(
        notification_id=N,
        tenant_id=T,
        kind="rule_fired",
        severity="warning",
        device_id=D,
        rule_id=None,
        device_name="Bay 1",
        rule_name="Greenhouse fan",
    )
    assert m["notification"] == {"title": "Greenhouse fan fired", "body": "Bay 1"}
    assert m["data"] == {
        "notification_id": str(N),
        "tenant_id": str(T),
        "kind": "rule_fired",
        "severity": "warning",
        "device_id": str(D),
    }
    assert m["android"]["priority"] == "NORMAL"
    assert m["android"]["notification"]["tag"] == f"rule_fired:{D}"

    offline = compose(
        notification_id=N,
        tenant_id=T,
        kind="device_offline",
        severity="critical",
        device_id=D,
        rule_id=None,
        device_name="Bay 1",
        rule_name=None,
    )
    assert offline["notification"]["title"] == "Bay 1 went offline"
    assert offline["android"]["priority"] == "HIGH"
    assert offline["android"]["notification"]["channel_id"] == "critical"


def test_unknown_kind_and_deleted_sources_still_read_well() -> None:
    m = compose(
        notification_id=N,
        tenant_id=T,
        kind="something_new",
        severity="warning",
        device_id=None,
        rule_id=None,
        device_name=None,
        rule_name=None,
    )
    assert m["notification"]["title"] == "New alert"
    assert "device_id" not in m["data"]


def test_reading_fcm_replies() -> None:
    assert classify(200, {"name": "x"}) is SendResult.SENT
    assert classify(404, {"error": {"details": [{"errorCode": "UNREGISTERED"}]}}) is SendResult.GONE
    assert (
        classify(
            400,
            {"error": {"message": "The registration token is not a valid FCM registration token"}},
        )
        is SendResult.GONE
    )
    assert classify(400, {"error": {"message": "Invalid JSON payload"}}) is SendResult.FAILED
    assert classify(403, {}) is SendResult.FAILED


def test_parsing_realtime_events() -> None:
    msg = {
        "type": "pmessage",
        "channel": f"realtime:{T}",
        "data": f'{{"type": "notification", "id": "{N}"}}',
    }
    assert _parse(msg) == (T, N)
    assert _parse({**msg, "data": '{"type": "telemetry"}'}) is None
    assert _parse({**msg, "channel": "realtime:not-a-uuid"}) is None
    assert _parse({**msg, "data": "not json"}) is None


@pytest.fixture
def account() -> ServiceAccount:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    return ServiceAccount(
        "io-test", "sa@io-test.iam.gserviceaccount.com", pem, "https://oauth2.example/token"
    )


async def test_client_gets_a_token_once_and_refreshes_on_401(account: ServiceAccount) -> None:
    calls: list[str] = []
    sends = iter([401, 200, 200])

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.host)
        if request.url.host == "oauth2.example":
            assert (
                b"grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer"
                in request.content
            )
            return httpx.Response(
                200, json={"access_token": f"tok{len(calls)}", "expires_in": 3600}
            )
        assert request.url.path == "/v1/projects/io-test/messages:send"
        return httpx.Response(next(sends), json={})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = FcmClient(account, http)
        assert await client.send({"token": "t"}) is SendResult.SENT  # 401 → new token → 200
        assert await client.send({"token": "t"}) is SendResult.SENT  # cached token
    assert calls.count("oauth2.example") == 2
    assert calls.count("fcm.googleapis.com") == 3
