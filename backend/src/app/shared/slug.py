"""Kebab-case slug derivation, shared by every module that turns a
free-text display name into a stable identifier (device slugs, tenant
slugs, catalog metric/actuator keys). Mirrored on the frontend by
frontend/src/lib/slug.ts — keep the two in sync.
"""

import re


def slugify(name: str, *, fallback: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return base or fallback
