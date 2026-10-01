"""Pydantic request/response models for the auth routes."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)
    tenant_name: str = Field(min_length=1, max_length=100)
    name: str | None = Field(default=None, max_length=200)


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
    name: str | None
    created_at: datetime


class UpdateProfileRequest(BaseModel):
    name: str | None = Field(default=None, max_length=200)


class InvitationPreviewResponse(BaseModel):
    """What the accept page shows before joining."""

    tenant_name: str
    email: str
    role: str
    expires_at: datetime
    # True when an account already uses the invited email: the page asks the
    # person to sign in instead of creating one.
    account_exists: bool


class AcceptInvitationRequest(BaseModel):
    """Only for new accounts; a signed-in invitee sends an empty body."""

    name: str | None = Field(default=None, max_length=200)
    password: str | None = Field(default=None, min_length=8, max_length=256)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=8, max_length=256)
