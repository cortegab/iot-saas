"""Pydantic schemas for telemetry ingestion (MQTT + HTTP fallback + EMQX
HTTP auth/authz callbacks). MQTT payloads and the HTTP fallback body are
untrusted input (CLAUDE.md §7) — both are validated here before anything
downstream sees them.
"""

from pydantic import BaseModel, Field, field_validator

# Status diagnostics are best-effort: a too-long or odd value is trimmed or
# dropped, never a reason to lose the message's `online` state.
MAX_FAULTS = 8
MAX_FAULT_LEN = 80
MAX_REASON_LEN = 32


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
    # Diagnostics (generic firmware 0.14.0+; all optional): why the chip last
    # restarted ("crash", "task_wdt", "brownout", ... firmware/src/diag.h),
    # boots since install, free heap now and its low-water mark (bytes),
    # Wi-Fi rejoins since boot, and the sensors not answering right now.
    reset_reason: str | None = None
    boot_count: int | None = None
    heap_free: int | None = None
    heap_min: int | None = None
    wifi_reconnects: int | None = None
    faults: list[str] | None = None

    @field_validator("reset_reason", mode="before")
    @classmethod
    def _short_reason(cls, v: object) -> object:
        return v[:MAX_REASON_LEN] if isinstance(v, str) else None

    @field_validator("boot_count", "heap_free", "heap_min", "wifi_reconnects", mode="before")
    @classmethod
    def _count(cls, v: object) -> object:
        return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < 2**31 else None

    @field_validator("faults", mode="before")
    @classmethod
    def _faults(cls, v: object) -> object:
        if not isinstance(v, list):
            return None
        return [f[:MAX_FAULT_LEN] for f in v if isinstance(f, str) and f][:MAX_FAULTS]


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
