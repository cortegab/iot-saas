"""Pydantic request/response models for the tenant routes.

Register/login's membership list reuses app.auth.schemas.MembershipSummary
(same tenant_id/tenant_name/role shape) rather than duplicating it here.
"""

import uuid

from pydantic import BaseModel, Field

from app.tenants.models import TenantRole


class TenantCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class TenantResponse(BaseModel):
    id: uuid.UUID
    name: str
    slug: str


class MemberResponse(BaseModel):
    user_id: uuid.UUID
    email: str
    role: str


class AddMemberRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: TenantRole = TenantRole.VIEWER


class ChangeRoleRequest(BaseModel):
    role: TenantRole
