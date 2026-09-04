"""Pydantic response models for per-metric device health."""

from datetime import datetime

from pydantic import BaseModel


class MetricHealthResponse(BaseModel):
    metric: str
    last_value: float | None
    last_seen_at: datetime | None
