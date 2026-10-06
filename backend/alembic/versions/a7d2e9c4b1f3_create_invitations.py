"""create invitations table and invitation lookup function

Revision ID: a7d2e9c4b1f3
Revises: f6c1a8d4e2b7
Create Date: 2026-09-30T19:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7d2e9c4b1f3"
down_revision: str | Sequence[str] | None = "f6c1a8d4e2b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Member invitations (DESIGN.md §8): an emailed, single-use link valid for
    7 days. Tenant-scoped with the standard RLS predicate (CLAUDE.md §9.4).
    Only a SHA-256 of the token is stored — it's 32 random bytes, so a fast
    hash is enough (argon2id is for low-entropy secrets) and it can be looked
    up directly.

    The accept page has no tenant context yet, so one narrow SECURITY DEFINER
    function resolves a token hash to its invitation — the same pattern as
    35a1d5682e9f_add_device_auth_lookup_functions.py. Everything else about
    the table stays RLS-protected.
    """
    op.create_table(
        "invitations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Uuid(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False, unique=True),
        sa.Column(
            "invited_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("role IN ('owner', 'admin', 'viewer')", name="ck_invitations_role"),
    )
    op.execute("CREATE INDEX ix_invitations_tenant_email ON invitations (tenant_id, lower(email))")

    op.execute("ALTER TABLE invitations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE invitations FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON invitations
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON invitations TO iot_app")

    op.execute(
        """
        CREATE FUNCTION lookup_invitation(p_token_hash text)
        RETURNS TABLE(
            id uuid,
            tenant_id uuid,
            tenant_name text,
            email text,
            role text,
            expires_at timestamptz,
            accepted_at timestamptz,
            revoked_at timestamptz
        )
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            SELECT i.id, i.tenant_id, t.name, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at
            FROM invitations i
            JOIN tenants t ON t.id = i.tenant_id
            WHERE i.token_hash = p_token_hash
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION lookup_invitation(text) TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP FUNCTION IF EXISTS lookup_invitation(text)")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON invitations")
    op.drop_table("invitations")
