#!/usr/bin/env bash
#
# wipe-prod.sh — erase ALL data from PRODUCTION (iodriven.tech).
#
# Truncates every row in every application table, flushes Redis, clears EMQX
# retained messages, and restarts api + worker. The schema, alembic migration
# history, the `iot_app` role, RLS policies, the TimescaleDB extension, and
# every Docker volume (including certbot-certs — the TLS cert) are KEPT. This
# is a data reset, not a teardown — it never runs `down` / `down -v`.
#
# On-demand only. The deploy workflow does NOT call this.
#
# Run on the VPS, from the repo root, as the `deploy` user:
#   cd ~/iot-saas && bash scripts/wipe-prod.sh          # prompts for confirmation
#   cd ~/iot-saas && bash scripts/wipe-prod.sh --yes    # skip the prompt
#
# Everyone is logged out afterwards. The first fresh registration through the
# UI recreates the tenant and its "Legacy / Uncategorized" device template.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"
TARGET="PRODUCTION — iodriven.tech"
PHRASE="wipe iodriven.tech"

if [ "${1:-}" != "--yes" ]; then
  echo "This ERASES all data in ${TARGET}. It cannot be undone. There is no backup."
  read -rp "Type '${PHRASE}' to continue: " ans </dev/tty
  [ "$ans" = "${PHRASE}" ] || { echo "Aborted."; exit 1; }
fi

PSQL="$COMPOSE exec -T timescaledb psql -U iot -d iot -v ON_ERROR_STOP=1"

$COMPOSE ps --status running timescaledb redis emqx >/dev/null 2>&1 \
  || { echo "The stack isn't running — 'up -d' first."; exit 1; }

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
