"""api keys: expiry and the auth lookup function

Revision ID: c9f3a7e1d5b2
Revises: b4e8c2f6a9d1
Create Date: 2026-09-30T20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9f3a7e1d5b2"
down_revision: str | Sequence[str] | None = "b4e8c2f6a9d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    API keys become usable credentials (DESIGN.md changelog): `expires_at`
    (NULL = never), and one narrow SECURITY DEFINER function that resolves the
    key id embedded in a presented key (`iot_{key_id}_{secret}`) to its hash,
    tenant and role — the request has no tenant context until the key is
    verified. Same pattern as 35a1d5682e9f_add_device_auth_lookup_functions.py;
    the api_keys table itself stays RLS-protected.
    """
    op.add_column("api_keys", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        """
        CREATE FUNCTION lookup_api_key(p_key_id text)
        RETURNS TABLE(
            id uuid,
            tenant_id uuid,
            key_hash text,
            role text,
            expires_at timestamptz,
            revoked_at timestamptz,
            last_used_at timestamptz
        )
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            SELECT k.id, k.tenant_id, k.key_hash, k.role, k.expires_at, k.revoked_at, k.last_used_at
            FROM api_keys k
            WHERE split_part(k.key_prefix, '_', 2) = p_key_id
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION lookup_api_key(text) TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP FUNCTION IF EXISTS lookup_api_key(text)")
    op.drop_column("api_keys", "expires_at")
