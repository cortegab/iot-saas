"""Pydantic request/response models for the tenant routes.

Register/login's membership list reuses app.auth.schemas.MembershipSummary
(same tenant_id/tenant_name/role shape) rather than duplicating it here.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.tenants.models import TenantRole


class TenantCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class TenantUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    # Recipient list for rule notification email alerts. Bare `str` — the repo
    # has no `pydantic[email]` dependency (see auth/schemas.py). At most 50, so
    # a fat-fingered paste can't blow up every alert.
    notification_emails: list[str] | None = Field(default=None, max_length=50)


class TenantResponse(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    notification_emails: list[str]
    created_at: datetime


class MemberResponse(BaseModel):
    user_id: uuid.UUID
    email: str
    role: str


class AddMemberRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: TenantRole = TenantRole.VIEWER


class ChangeRoleRequest(BaseModel):
    role: TenantRole
