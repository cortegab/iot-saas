"""Pydantic schemas for the telemetry query API."""

from datetime import datetime

from pydantic import BaseModel


class TelemetryLatestResponse(BaseModel):
    metric: str
    value: float
    time: datetime


class TelemetryDataPoint(BaseModel):
    time: datetime
    value: float


class TelemetryDataResponse(BaseModel):
    metric: str
    resolution: str
    points: list[TelemetryDataPoint]
