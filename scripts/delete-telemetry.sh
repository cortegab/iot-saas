#!/usr/bin/env bash
#
# delete-telemetry.sh — delete one tenant's metric data (telemetry), LOCAL or PRODUCTION.
#
# Deletes the tenant's rows from the `telemetry` hypertable (compressed chunks
# included) and its per-sensor latest values (`device_metric_health`, which the
# next reading recreates), then refreshes the telemetry_1m / telemetry_1h
# rollups over the deleted time range, since their refresh policy only revisits
# a recent window and older buckets would keep showing the deleted data.
#
# Devices, templates, rules, commands, notifications and everything else are
# KEPT. Nothing is restarted: the worker's in-memory rule state is untouched.
#
#   bash scripts/delete-telemetry.sh local <tenant>                  # prompts
#   bash scripts/delete-telemetry.sh local <tenant> --device <device>
#   bash scripts/delete-telemetry.sh prod  <tenant> --yes            # skip the prompt
#
# <tenant> is the tenant's id (uuid) or slug; <device> is a device id or slug
# within that tenant (only that device's data is deleted).
#
# `prod` runs on the VPS, from the repo root, as the `deploy` user (like
# scripts/wipe-prod.sh):  ssh deploy@<VPS> 'cd ~/iot-saas && bash scripts/delete-telemetry.sh prod <tenant>'
# Take a backup first (infra/backups/backup.sh) if the data might be needed.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
  echo "Usage: bash scripts/delete-telemetry.sh <local|prod> <tenant id or slug> [--device <device id or slug>] [--yes]"
  exit 2
}

ENV="${1:-}"; TENANT="${2:-}"
[ -n "$ENV" ] && [ -n "$TENANT" ] || usage
shift 2
DEVICE=""; YES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --device) DEVICE="${2:-}"; [ -n "$DEVICE" ] || usage; shift 2 ;;
    --yes) YES=1; shift ;;
    *) usage ;;
  esac
done

case "$ENV" in
  local) COMPOSE="docker compose -f infra/docker-compose.yml"; WHERE="the LOCAL dev database" ;;
  prod)  COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"; WHERE="PRODUCTION — iodriven.tech" ;;
  *) usage ;;
esac

ID_RE='^[A-Za-z0-9-]{1,100}$'
[[ "$TENANT" =~ $ID_RE ]] || { echo "Not a tenant id or slug: $TENANT"; exit 2; }
[ -z "$DEVICE" ] || [[ "$DEVICE" =~ $ID_RE ]] || { echo "Not a device id or slug: $DEVICE"; exit 2; }

$COMPOSE ps --status running timescaledb >/dev/null 2>&1 \
  || { echo "The database isn't running in $WHERE — 'up -d' first."; exit 1; }

# Values reach SQL only as psql variables (:'t', :'d'), never spliced into the text.
q() { $COMPOSE exec -T timescaledb psql -U iot -d iot -X -q -tA -F '|' -v ON_ERROR_STOP=1 -v t="$TENANT" -v d="$DEVICE" "$@"; }

IFS='|' read -r TENANT_ID TENANT_SLUG TENANT_NAME < <(q <<'SQL'
SELECT id, slug, name FROM tenants WHERE id::text = :'t' OR slug = :'t' LIMIT 1;
SQL
) || true
[ -n "${TENANT_ID:-}" ] || { echo "No tenant '$TENANT' in $WHERE."; exit 1; }

DEVICE_ID=""; SCOPE="all devices"
if [ -n "$DEVICE" ]; then
  IFS='|' read -r DEVICE_ID DEVICE_NAME < <(q -v tid="$TENANT_ID" <<'SQL'
SELECT id, name FROM devices WHERE tenant_id = :'tid' AND (id::text = :'d' OR slug = :'d') LIMIT 1;
SQL
  ) || true
  [ -n "$DEVICE_ID" ] || { echo "No device '$DEVICE' in tenant $TENANT_SLUG."; exit 1; }
  SCOPE="device $DEVICE_NAME ($DEVICE_ID)"
fi

# The same filter for every statement below: the tenant, and the device when given.
FILTER="tenant_id = :'tid' AND (:'did' = '' OR device_id::text = :'did')"
qs() { q -v tid="$TENANT_ID" -v did="$DEVICE_ID" "$@"; }

IFS='|' read -r ROWS FIRST LAST DEVICES HEALTH < <(qs <<SQL
SELECT count(*), coalesce(min(time)::text, ''), coalesce(max(time)::text, ''), count(DISTINCT device_id),
       (SELECT count(*) FROM device_metric_health WHERE $FILTER)
  FROM telemetry WHERE $FILTER;
SQL
)

echo "Target:  $WHERE"
echo "Tenant:  $TENANT_NAME ($TENANT_SLUG, $TENANT_ID)"
echo "Scope:   $SCOPE"
echo "Deletes: $ROWS telemetry rows from $DEVICES device(s)${FIRST:+, $FIRST → $LAST}; $HEALTH latest-value rows"

if [ "$ROWS" = "0" ] && [ "$HEALTH" = "0" ]; then echo "Nothing to delete."; exit 0; fi

if [ -z "$YES" ]; then
  PHRASE="delete $TENANT_SLUG"
  echo "This cannot be undone.$( [ "$ENV" = prod ] && echo ' Take a backup first (infra/backups/backup.sh) if the data might be needed.')"
  read -rp "Type '${PHRASE}' to continue: " ans </dev/tty
  [ "$ans" = "$PHRASE" ] || { echo "Aborted."; exit 1; }
fi

echo "==> Deleting"
qs <<SQL
BEGIN;
DELETE FROM telemetry WHERE $FILTER;
DELETE FROM device_metric_health WHERE $FILTER;
COMMIT;
SQL

if [ -n "$FIRST" ]; then
  echo "==> Refreshing rollups over $FIRST → $LAST"
  # Hour-aligned, so the 1 h bucket at each end is recomputed too. Each CALL
  # runs on its own (it can't run inside a transaction block).
  for cagg in telemetry_1m telemetry_1h; do
    q -v first="$FIRST" -v last="$LAST" -v cagg="$cagg" <<'SQL'
CALL refresh_continuous_aggregate(:'cagg', date_trunc('hour', :'first'::timestamptz), date_trunc('hour', :'last'::timestamptz) + interval '1 hour');
SQL
  done
fi

LEFT=$(qs <<SQL
SELECT count(*) FROM telemetry WHERE $FILTER;
SQL
)
echo "Done. Telemetry rows left for this scope: $LEFT"
