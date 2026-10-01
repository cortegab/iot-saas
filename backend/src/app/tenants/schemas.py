"""Pydantic request/response models for the tenant routes.

Register/login's membership list reuses app.auth.schemas.MembershipSummary
(same tenant_id/tenant_name/role shape) rather than duplicating it here.
"""

import re
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator

from app.tenants.models import TenantRole

_EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")


class TenantCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class TenantUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    # Recipient list for rule notification email alerts. Bare `str` — the repo
    # has no `pydantic[email]` dependency (see auth/schemas.py). At most 50, so
    # a fat-fingered paste can't blow up every alert.
    notification_emails: list[str] | None = Field(default=None, max_length=50)
    timezone: str | None = Field(default=None, max_length=64)

    @field_validator("notification_emails")
    @classmethod
    def _emails(cls, emails: list[str] | None) -> list[str] | None:
        if emails is None:
            return None
        cleaned = [e.strip().lower() for e in emails if e.strip()]
        bad = [e for e in cleaned if not _EMAIL.fullmatch(e)]
        if bad:
            raise ValueError(f"Not an email address: {bad[0]}")
        return list(dict.fromkeys(cleaned))

    @field_validator("timezone")
    @classmethod
    def _zone(cls, zone: str | None) -> str | None:
        if zone is None:
            return None
        try:
            ZoneInfo(zone)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"Unknown time zone: {zone}") from exc
        return zone


class TenantResponse(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    notification_emails: list[str]
    timezone: str
    created_at: datetime


class MemberResponse(BaseModel):
    user_id: uuid.UUID
    email: str
    role: str
    name: str | None = None
    joined_at: datetime | None = None


class InvitationCreateRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: TenantRole = TenantRole.VIEWER


class InvitationResponse(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    created_at: datetime
    expires_at: datetime


class AddMemberRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: TenantRole = TenantRole.VIEWER


class ChangeRoleRequest(BaseModel):
    role: TenantRole
