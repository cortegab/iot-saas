"""Pydantic request/response models for the API key routes."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.tenants.models import TenantRole


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    role: TenantRole = TenantRole.VIEWER


class ApiKeyResponse(BaseModel):
    id: uuid.UUID
    name: str
    key_prefix: str
    role: str
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class ApiKeyCreateResponse(BaseModel):
    api_key: ApiKeyResponse
    key: str = Field(description="The full secret — shown once, never retrievable again")
