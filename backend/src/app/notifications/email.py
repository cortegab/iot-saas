"""Transactional email delivery for rule notifications (Phase 4).

One pluggable provider, chosen at deploy time via `settings.email_provider`:

- `console` (default) — logs the rendered message and sends nothing. Local
  dev and the test suite need no SMTP server, and no test flakiness.
- `smtp` — sends via `aiosmtplib`. Auto-detects implicit TLS (port 465) vs
  STARTTLS (port 587, or any other port when `SMTP_USE_TLS=true`) from
  `SMTP_PORT` — see SmtpEmailProvider.send. Works with any provider: Gmail,
  SES-SMTP, Mailgun, Hostinger, a self-hosted relay.

A future HTTP-API provider (Resend / SES SendEmail) is a drop-in behind the
same `EmailProvider` protocol — `httpx` is already a dependency. This module
has no routes and no models; it is a delivery helper like `realtime/`'s.
"""

import logging
from dataclasses import dataclass
from email.message import EmailMessage as _StdEmailMessage
from typing import Protocol

import aiosmtplib

from app.config import Settings, settings

log = logging.getLogger("notifications.email")


@dataclass(frozen=True)
class EmailMessage:
    to: list[str]
    subject: str
    body: str


class EmailProvider(Protocol):
    async def send(self, message: EmailMessage) -> None:
        """Deliver the message. Raises on failure — the caller
        (app.rules.executors.EmailExecutor) retries with backoff."""
        ...


class ConsoleEmailProvider:
    """Logs the message, sends nothing. The default."""

    async def send(self, message: EmailMessage) -> None:
        log.info(
            "console email -> %s | subject=%r | body=%r",
            ", ".join(message.to),
            message.subject,
            message.body,
        )


class SmtpEmailProvider:
    def __init__(self, config: Settings) -> None:
        if not config.smtp_host:
            # Fail fast at worker/API start, not at the first alert.
            raise RuntimeError("EMAIL_PROVIDER=smtp requires SMTP_HOST to be set")
        self._host = config.smtp_host
        self._port = config.smtp_port
        self._username = config.smtp_username
        self._password = config.smtp_password.get_secret_value()
        self._use_tls = config.smtp_use_tls
        self._from = config.email_from

    async def send(self, message: EmailMessage) -> None:
        msg = _StdEmailMessage()
        msg["From"] = self._from
        msg["To"] = ", ".join(message.to)
        msg["Subject"] = message.subject
        msg.set_content(message.body)
        # aiosmtplib distinguishes implicit TLS (the connection is TLS from
        # the first byte — port 465's convention) from STARTTLS (a plain
        # connection upgraded in-band via the STARTTLS command — port 587's
        # convention). They're different wire protocols, not the same toggle
        # at two ports: passing start_tls against a 465 server times out
        # (or is rejected) because the server is already speaking TLS before
        # the client's opening "EHLO" is even readable. Port 465 is
        # implicit-TLS on every provider that offers it (Hostinger included).
        implicit_tls = self._port == 465
        await aiosmtplib.send(
            msg,
            hostname=self._host,
            port=self._port,
            username=self._username or None,
            password=self._password or None,
            use_tls=implicit_tls,
            start_tls=self._use_tls and not implicit_tls,
        )


_provider: EmailProvider | None = None


def get_email_provider() -> EmailProvider:
    """Module-singleton provider, selected by `settings.email_provider`."""
    global _provider
    if _provider is None:
        _provider = (
            SmtpEmailProvider(settings)
            if settings.email_provider == "smtp"
            else ConsoleEmailProvider()
        )
    return _provider
