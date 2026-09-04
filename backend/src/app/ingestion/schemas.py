"""Pydantic schemas for telemetry ingestion (MQTT + HTTP fallback + EMQX
HTTP auth/authz callbacks). MQTT payloads and the HTTP fallback body are
untrusted input (CLAUDE.md §7) — both are validated here before anything
downstream sees them.
"""

from pydantic import BaseModel, Field


class TelemetryPayload(BaseModel):
    """The device-facing telemetry payload (CLAUDE.md §4). `timestamp` is Unix
    seconds and optional — ingestion stamps server time when absent.
    """

    value: float
    timestamp: int | None = None


class StatusPayload(BaseModel):
    """The device-facing health-snapshot payload on the reserved
    {tenant}/{device}/status topic (CLAUDE.md §4) — both a periodic
    self-report and the device's own Last-Will payload (retained `online:
    false` on ungraceful disconnect). `timestamp` is informational only: the
    platform always stamps its own receive time for staleness math, since an
    LWT's payload is fixed at connect time and can't reflect the actual
    disconnect moment.
    """

    online: bool
    rssi: int | None = None
    battery_pct: int | None = None
    uptime_s: int | None = None
    fw_version: str | None = None
    timestamp: int | None = None


class IngestRequest(BaseModel):
    """Body for the HTTP REST ingest fallback. The device itself is identified
    by its Basic-auth credentials, not by anything in the body.
    """

    metric: str = Field(min_length=1, max_length=100)
    value: float
    timestamp: int | None = None


class EmqxAuthenticateRequest(BaseModel):
    username: str
    password: str


class EmqxAuthenticateResponse(BaseModel):
    result: str  # "allow" | "deny"
    is_superuser: bool = False


class EmqxAuthorizeRequest(BaseModel):
    username: str
    topic: str
    action: str  # "publish" | "subscribe"


class EmqxAuthorizeResponse(BaseModel):
    result: str  # "allow" | "deny"
