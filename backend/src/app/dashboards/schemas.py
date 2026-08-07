"""Pydantic request/response models for the dashboards routes."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

WidgetType = Literal["value_card", "trend_chart", "device_status", "actuator_control", "gauge"]


class Widget(BaseModel):
    """One grid item. Kept deliberately loose — a widget referencing a
    nonexistent or foreign device just renders an error/empty state
    client-side the next time it fetches through the normal tenant-scoped
    device endpoints, so there's no server-side cross-referencing to do here.
    """

    id: str = Field(min_length=1, max_length=64)
    type: WidgetType
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    w: int = Field(ge=1)
    h: int = Field(ge=1)
    device_id: uuid.UUID
    # Required by value_card/trend_chart/gauge, unused by device_status/actuator_control.
    metric: str | None = None
    # Required by gauge (the value range the arc scales against), unused otherwise.
    min: float | None = None
    max: float | None = None


class DashboardCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class DashboardUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    layout: list[Widget] | None = None


class DashboardResponse(BaseModel):
    id: uuid.UUID
    name: str
    layout: list[Widget]
    created_at: datetime
    updated_at: datetime
