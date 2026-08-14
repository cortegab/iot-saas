#!/usr/bin/env bash
#
# restore.sh — restore a pg_dump custom-format backup (produced by backup.sh)
# into the running production TimescaleDB container.
#
# THIS IS DESTRUCTIVE: it drops and recreates every object in the target
# database before restoring. Never run it against a database you don't intend
# to fully replace. Confirmation is required (type the database name back).
#
# Usage:
#   bash infra/backups/restore.sh /var/backups/iot-saas/iot-20260101T000000Z.dump
#
# See infra/backups/RESTORE_RUNBOOK.md for the full drill, including how to
# rehearse this against a scratch database before you ever need it for real.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/infra/.env.prod"
COMPOSE="docker compose -f $ROOT_DIR/infra/docker-compose.prod.yml --env-file $ENV_FILE"

DUMP_FILE="${1:?Usage: restore.sh <path-to-dump-file>}"
[ -f "$DUMP_FILE" ] || { echo "No such file: $DUMP_FILE" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a

echo "About to restore ${DUMP_FILE} into database '${POSTGRES_DB}', REPLACING its"
echo "current contents. This cannot be undone."
read -r -p "Type the database name (${POSTGRES_DB}) to confirm: " confirm
[ "$confirm" = "$POSTGRES_DB" ] || { echo "Aborted."; exit 1; }

echo "==> Terminating other connections to ${POSTGRES_DB}"
$COMPOSE exec -T timescaledb psql -U "$POSTGRES_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();"

# TimescaleDB's documented pg_dump/pg_restore procedure: these two calls
# suspend and resume the background workers that manage chunk
# compression/retention jobs so pg_restore doesn't race them while catalog
# tables are being rewritten.
echo "==> timescaledb_pre_restore()"
$COMPOSE exec -T timescaledb psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT timescaledb_pre_restore();"

echo "==> Restoring ${DUMP_FILE}"
$COMPOSE exec -T timescaledb pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists --no-owner < "$DUMP_FILE"

echo "==> timescaledb_post_restore()"
$COMPOSE exec -T timescaledb psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT timescaledb_post_restore();"

echo "==> Done. Verify with: docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec timescaledb psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} -c '\\dt'"
