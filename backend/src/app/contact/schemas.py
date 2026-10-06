"""Pydantic models for the public contact form (POST /public/contact)."""

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

_EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")


class ContactRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    company: str = Field(min_length=1, max_length=160)
    deployment: Literal["cloud", "dedicated", "on_prem", "not_sure"] = "not_sure"
    devices: Literal["<100", "100-500", "500-1000", ">1000"] | None = None
    # Optional: sites, equipment (OPC UA, Modbus…), network constraints.
    message: str = Field(default="", max_length=4000)
    # Honeypot: hidden from people, filled in by bots. Never shown, never sent.
    website: str | None = Field(default=None, max_length=200)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip()
        if not _EMAIL.fullmatch(v):
            raise ValueError("Enter an email address")
        return v


class ContactResponse(BaseModel):
    detail: str
