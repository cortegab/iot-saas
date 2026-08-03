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
