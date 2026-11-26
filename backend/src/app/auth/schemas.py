"""Pydantic request/response models for the auth routes."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# DESIGN.md §11a: the languages the platform speaks.
Locale = Literal["en", "es"]


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)
    tenant_name: str = Field(min_length=1, max_length=100)
    name: str | None = Field(default=None, max_length=200)
    # The browser's language when signing up (DESIGN.md §11a): the new
    # workspace's email language. Not saved as the person's choice.
    locale: Locale | None = None


class GoogleSignInRequest(BaseModel):
    """Sign in (or sign up) with a Google ID token (ease-of-use plan B5)."""

    id_token: str = Field(min_length=20, max_length=8192)
    # A new account's first workspace (Register's field); ignored for an
    # existing account or when joining by invitation.
    tenant_name: str | None = Field(default=None, max_length=100)
    # Join that invitation's workspace (its email must be the Google one).
    invitation_token: str | None = Field(default=None, max_length=200)
    # The browser's language, for a new account's first workspace.
    locale: Locale | None = None


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
    # Their chosen language; null = follow the browser or phone.
    locale: Locale | None = None


class UpdateProfileRequest(BaseModel):
    """Only the fields sent change: `{"locale": null}` goes back to following
    the browser, and leaves the name alone."""

    name: str | None = Field(default=None, max_length=200)
    locale: Locale | None = None


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
