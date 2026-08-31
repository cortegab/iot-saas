#!/usr/bin/env bash
#
# wipe-local.sh — erase ALL data from the LOCAL dev stack.
#
# Truncates every row in every application table, flushes Redis, clears EMQX
# retained messages, and restarts api + worker. The schema, alembic migration
# history, the `iot_app` role, RLS policies, the TimescaleDB extension, and
# every Docker volume are KEPT — this is a data reset, not a teardown.
#
# On-demand only. Nothing calls this automatically.
#
#   bash scripts/wipe-local.sh          # prompts for confirmation
#   bash scripts/wipe-local.sh --yes    # skip the prompt (CI / scripted use)
#
# The prod equivalent is scripts/wipe-prod.sh (run on the VPS).

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

COMPOSE="docker compose -f infra/docker-compose.yml"
TARGET="the LOCAL dev database"
PHRASE="wipe local"

if [ "${1:-}" != "--yes" ]; then
  echo "This ERASES all data in ${TARGET}. It cannot be undone."
  read -rp "Type '${PHRASE}' to continue: " ans </dev/tty
  [ "$ans" = "${PHRASE}" ] || { echo "Aborted."; exit 1; }
fi

PSQL="$COMPOSE exec -T timescaledb psql -U iot -d iot -v ON_ERROR_STOP=1"

$COMPOSE ps --status running timescaledb redis emqx >/dev/null 2>&1 \
  || { echo "The stack isn't running — start it with 'docker compose -f infra/docker-compose.yml up -d' first."; exit 1; }

echo "==> Postgres: truncating every table in public (keeping alembic_version)"
$PSQL <<'SQL'
DO $$
DECLARE stmt text;
BEGIN
  SELECT 'TRUNCATE TABLE '
       || string_agg(format('%I.%I', schemaname, tablename), ', ')
       || ' RESTART IDENTITY CASCADE'
    INTO stmt
    FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename <> 'alembic_version';
  IF stmt IS NULL THEN
    RAISE NOTICE 'no application tables found';
  ELSE
    RAISE NOTICE '%', stmt;
    EXECUTE stmt;
  END IF;
END $$;
SQL

echo "==> Postgres: rebuilding continuous-aggregate rollups from the empty source"
# telemetry_1m / telemetry_1h are materialized_only = false, so already-
# materialized buckets survive TRUNCATE — refresh the full range to clear them.
for cagg in $($PSQL -tAc \
    "SELECT view_name FROM timescaledb_information.continuous_aggregates" 2>/dev/null || true); do
  $PSQL -c "CALL refresh_continuous_aggregate('${cagg}', NULL, NULL);" \
    || echo "   (skipped ${cagg})"
done

echo "==> Redis: FLUSHALL (telemetry stream + consumer group, cache, pub/sub, rate-limit keys)"
$COMPOSE exec -T redis redis-cli FLUSHALL

echo "==> EMQX: clearing retained messages ({tenant}/{device}/state/{actuator})"
$COMPOSE exec -T emqx emqx ctl retainer clean \
  || echo "   (retainer not active — nothing to clean)"

echo "==> Restarting api + worker (drops the worker's cached rules, recreates the Redis stream)"
$COMPOSE restart api worker

echo
echo "Done. Current state:"
$PSQL -c "SELECT
  (SELECT count(*) FROM tenants)   AS tenants,
  (SELECT count(*) FROM users)     AS users,
  (SELECT count(*) FROM devices)   AS devices,
  (SELECT count(*) FROM telemetry) AS telemetry;"
$PSQL -tAc "SELECT 'schema at alembic revision: ' || version_num FROM alembic_version;"
