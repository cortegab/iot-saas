"""The public contact form: rate-limited per client, honeypot-filtered,
emailed to CONTACT_EMAIL_TO through the existing mailer. Nothing is stored —
no table, no tenant, so no RLS to speak of.
"""

import logging

from app.config import settings
from app.contact.schemas import ContactRequest
from app.notifications.email import EmailMessage, send_soon
from app.redis import redis_client

log = logging.getLogger(__name__)

RATE_LIMIT = 5
RATE_WINDOW_S = 60 * 60

_DEPLOYMENT = {
    "cloud": "Cloud",
    "dedicated": "Dedicated cloud",
    "on_prem": "On-premise",
    "not_sure": "Not sure yet",
}


class RateLimitedError(Exception):
    pass


async def submit(req: ContactRequest, client: str) -> None:
    """Send one enquiry. A filled honeypot is accepted silently (a bot learns
    nothing); more than RATE_LIMIT per client per hour is refused."""
    if req.website:
        log.info("contact form honeypot hit from %s", client)
        return
    key = f"contact:rate:{client}"
    count = int(await redis_client.get(key) or 0)
    if count >= RATE_LIMIT:
        raise RateLimitedError
    await redis_client.set(key, str(count + 1), ex=RATE_WINDOW_S)

    lines = [
        f"From: {req.name} <{req.email}>",
        f"Company: {req.company or '—'}",
        f"Deployment: {_DEPLOYMENT[req.deployment]}",
        f"Devices: {req.devices or '—'}",
        "",
        req.message or "(no message)",
    ]
    if not settings.contact_email_to:
        log.warning("CONTACT_EMAIL_TO is not set; enquiry from %s only logged", req.email)
        log.info("contact enquiry:\n%s", "\n".join(lines))
        return
    await send_soon(
        EmailMessage(
            to=[a.strip() for a in settings.contact_email_to.split(",") if a.strip()],
            subject=f"Website enquiry from {req.name}",
            body="\n".join(lines),
        )
    )
