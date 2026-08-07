"""Pydantic request/response models for the auth routes."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)
    tenant_name: str = Field(min_length=1, max_length=100)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class MembershipSummary(BaseModel):
    tenant_id: uuid.UUID
    tenant_name: str
    tenant_slug: str
    role: str


class TokenPairResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    memberships: list[MembershipSummary]


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    created_at: datetime
