"""Pydantic request/response models for the API key routes."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.tenants.models import TenantRole


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    role: TenantRole = TenantRole.VIEWER
    # Days until the key stops working; null = never.
    expires_in_days: int | None = Field(default=90, ge=1, le=3650)

    @field_validator("role")
    @classmethod
    def _not_owner(cls, role: TenantRole) -> TenantRole:
        if role == TenantRole.OWNER:
            raise ValueError("API keys can be Viewer or Admin, never Owner")
        return role


class ApiKeyResponse(BaseModel):
    id: uuid.UUID
    name: str
    key_prefix: str
    role: str
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    expires_at: datetime | None


class ApiKeyCreateResponse(BaseModel):
    api_key: ApiKeyResponse
    key: str = Field(description="The full secret — shown once, never retrievable again")
