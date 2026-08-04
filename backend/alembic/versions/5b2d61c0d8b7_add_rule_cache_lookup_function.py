"""add rule cache lookup function

Revision ID: 5b2d61c0d8b7
Revises: 327081b5010e
Create Date: 2026-08-03 19:01:06.292915

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5b2d61c0d8b7"
down_revision: str | Sequence[str] | None = "327081b5010e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    The worker's rule cache (app.rules.service.load_rule_cache) needs to read
    active rules across every tenant, the same chicken-and-egg problem devices
    had in Phase 2: `rules` has RLS, so a session with no tenant context set
    (there is no single tenant here — the worker caches everyone's rules)
    sees zero rows by design. This is the same narrow, auditable SECURITY
    DEFINER escape hatch as
    35a1d5682e9f_add_device_auth_lookup_functions.py's lookup functions:
    owned by the migration role so it bypasses RLS internally, EXECUTE-only
    granted to iot_app. Everything else about `rules` (the CRUD API) stays
    exactly as RLS-protected as before.
    """
    op.execute(
        """
        CREATE FUNCTION list_enabled_rules()
        RETURNS SETOF rules
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            SELECT * FROM rules WHERE enabled = true
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION list_enabled_rules() TO iot_app")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP FUNCTION IF EXISTS list_enabled_rules()")
