"""Firebase Cloud Messaging, HTTP v1, without Google's SDK: a service-account
JWT exchanged for an access token (cached until shortly before it expires),
then one POST per phone. Reads the service-account JSON named by
FCM_SERVICE_ACCOUNT_FILE; with none configured, push is off.
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any

import httpx
import jwt

log = logging.getLogger(__name__)

SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
SEND_URL = "https://fcm.googleapis.com/v1/projects/{project}/messages:send"
# Refresh this long before the token's own expiry.
TOKEN_MARGIN_S = 300


class SendResult(Enum):
    SENT = "sent"
    # The token no longer exists (app uninstalled, token rotated): forget it.
    GONE = "gone"
    FAILED = "failed"


@dataclass(frozen=True)
class ServiceAccount:
    project_id: str
    client_email: str
    private_key: str
    token_uri: str

    @classmethod
    def load(cls, path: str) -> "ServiceAccount":
        data = json.loads(Path(path).read_text())
        return cls(
            project_id=data["project_id"],
            client_email=data["client_email"],
            private_key=data["private_key"],
            token_uri=data.get("token_uri", "https://oauth2.googleapis.com/token"),
        )


def classify(status: int, body: object) -> SendResult:
    """FCM's reply to one send. UNREGISTERED (404) and an invalid
    registration token (400) mean the phone is gone; anything else that
    isn't 200 is a failure worth logging, not a reason to drop the phone."""
    if status == 200:
        return SendResult.SENT
    error = body.get("error", {}) if isinstance(body, dict) else {}
    codes = {
        d.get("errorCode")
        for d in error.get("details", [])
        if isinstance(d, dict) and d.get("errorCode")
    }
    message = str(error.get("message", ""))
    if status == 404 or "UNREGISTERED" in codes:
        return SendResult.GONE
    if status == 400 and "registration token" in message.lower():
        return SendResult.GONE
    return SendResult.FAILED


class FcmClient:
    def __init__(self, account: ServiceAccount, http: httpx.AsyncClient) -> None:
        self._account = account
        self._http = http
        self._token: str | None = None
        self._expires_at = 0.0
        self._lock = asyncio.Lock()

    async def _access_token(self, *, force: bool = False) -> str:
        async with self._lock:
            if not force and self._token and time.time() < self._expires_at - TOKEN_MARGIN_S:
                return self._token
            now = int(time.time())
            assertion = jwt.encode(
                {
                    "iss": self._account.client_email,
                    "scope": SCOPE,
                    "aud": self._account.token_uri,
                    "iat": now,
                    "exp": now + 3600,
                },
                self._account.private_key,
                algorithm="RS256",
            )
            resp = await self._http.post(
                self._account.token_uri,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": assertion,
                },
            )
            resp.raise_for_status()
            payload = resp.json()
            self._token = str(payload["access_token"])
            self._expires_at = now + int(payload.get("expires_in", 3600))
            return self._token

    async def send(self, message: dict[str, Any]) -> SendResult:
        """One message (`{"token": ..., "notification": ..., ...}`). Retries
        once on an expired access token and once on a server error."""
        url = SEND_URL.format(project=self._account.project_id)
        force = False
        for attempt in range(3):
            token = await self._access_token(force=force)
            resp = await self._http.post(
                url, json={"message": message}, headers={"Authorization": f"Bearer {token}"}
            )
            if resp.status_code == 401 and not force:
                force = True
                continue
            retryable = resp.status_code >= 500 or resp.status_code == 429
            if retryable and attempt < 2:
                await asyncio.sleep(1 + attempt)
                continue
            try:
                body: object = resp.json()
            except ValueError:
                body = {}
            result = classify(resp.status_code, body)
            if result is SendResult.FAILED:
                log.warning("FCM send failed (%s): %s", resp.status_code, str(body)[:300])
            return result
        return SendResult.FAILED
