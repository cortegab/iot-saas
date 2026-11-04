#!/usr/bin/env bash
#
# delete-operational-data.sh — delete what the platform recorded for one tenant
# while it ran, LOCAL or PRODUCTION. Its configuration stays.
#
# Deleted (for the tenant, or for one device with --device):
#   - telemetry: the `telemetry` hypertable (compressed chunks included), then
#     the telemetry_1m / telemetry_1h rollups are refreshed over the deleted
#     range (their refresh policy only revisits a recent window, so older
#     buckets would keep showing the deleted data)
#   - latest value per sensor (`device_metric_health`; the next reading recreates it)
#   - notifications: read, unread and dismissed
#   - rule activity: `rule_executions` and their `action_executions` (the
#     Activity tab, "last fired", Failed deliveries)
#   - commands (the command timeline, "Requested … / Acknowledged"), and the
#     retained desired state in EMQX ({tenant}/{device}/state/#), so a device
#     that reconnects isn't sent a command the UI no longer shows
#   - device status snapshot on `devices`: last seen, online, RSSI, battery,
#     uptime, firmware version (the device reads "Never connected" until it
#     publishes again, and Get started's device step is undone)
#   - latches: latched rules are reset, the same way as the rule page's Reset
#
# KEPT: devices and their credentials, templates, rules and their version
# history, zones, dashboards, members, invitations and API keys; each device's
# retained config and status topics. Nothing is restarted, so the worker's
# in-memory rule progress (hold timers, cooldowns) is untouched.
#
#   bash scripts/delete-operational-data.sh local <tenant>                  # prompts
#   bash scripts/delete-operational-data.sh local <tenant> --device <device>
#   bash scripts/delete-operational-data.sh prod  <tenant> --yes            # skip the prompt
#
# <tenant> is the tenant's id (uuid) or slug; <device> is a device id or slug
# within that tenant. With --device, rule activity and commands are the ones
# for that device, latches are reset on the rules that use it, and
# notifications about no device (template ones) are kept.
#
# `prod` runs on the VPS, from the repo root, as the `deploy` user (like
# scripts/wipe-prod.sh):  ssh deploy@<VPS> 'cd ~/iot-saas && bash scripts/delete-operational-data.sh prod <tenant>'
# Take a backup first (infra/backups/backup.sh) if the data might be needed.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
  echo "Usage: bash scripts/delete-operational-data.sh <local|prod> <tenant id or slug> [--device <device id or slug>] [--yes]"
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

$COMPOSE ps --status running timescaledb redis emqx >/dev/null 2>&1 \
  || { echo "The stack isn't running in $WHERE — 'up -d' first."; exit 1; }

# Values reach SQL only as psql variables (:'t', :'d'), never spliced into the text.
q() { $COMPOSE exec -T timescaledb psql -U iot -d iot -X -q -tA -F '|' -v ON_ERROR_STOP=1 -v t="$TENANT" -v d="$DEVICE" "$@"; }
redis() { $COMPOSE exec -T redis redis-cli "$@"; }

IFS='|' read -r TENANT_ID TENANT_SLUG TENANT_NAME < <(q <<'SQL'
SELECT id, slug, name FROM tenants WHERE id::text = :'t' OR slug = :'t' LIMIT 1;
SQL
) || true
[ -n "${TENANT_ID:-}" ] || { echo "No tenant '$TENANT' in $WHERE."; exit 1; }

DEVICE_ID=""; DEVICE_SLUG=""; SCOPE="all devices"
if [ -n "$DEVICE" ]; then
  IFS='|' read -r DEVICE_ID DEVICE_SLUG DEVICE_NAME < <(q -v tid="$TENANT_ID" <<'SQL'
SELECT id, slug, name FROM devices WHERE tenant_id = :'tid' AND (id::text = :'d' OR slug = :'d') LIMIT 1;
SQL
  ) || true
  [ -n "$DEVICE_ID" ] || { echo "No device '$DEVICE' in tenant $TENANT_SLUG."; exit 1; }
  SCOPE="device $DEVICE_NAME ($DEVICE_ID)"
fi

# The same filter for every statement below: the tenant, and the device when given.
FILTER="tenant_id = :'tid' AND (:'did' = '' OR device_id::text = :'did')"
qs() { q -v tid="$TENANT_ID" -v did="$DEVICE_ID" "$@"; }

IFS='|' read -r ROWS FIRST LAST DEVICES HEALTH NOTIFS RUNS ACTIONS COMMANDS STATUSES < <(qs <<SQL
SELECT count(*), coalesce(min(time)::text, ''), coalesce(max(time)::text, ''), count(DISTINCT device_id),
       (SELECT count(*) FROM device_metric_health WHERE $FILTER),
       (SELECT count(*) FROM notifications WHERE $FILTER),
       (SELECT count(*) FROM rule_executions WHERE $FILTER),
       (SELECT count(*) FROM action_executions
         WHERE rule_execution_id IN (SELECT id FROM rule_executions WHERE $FILTER)),
       (SELECT count(*) FROM commands WHERE $FILTER),
       (SELECT count(*) FROM devices WHERE tenant_id = :'tid' AND (:'did' = '' OR id::text = :'did')
          AND (last_seen_at IS NOT NULL OR last_status_at IS NOT NULL))
  FROM telemetry WHERE $FILTER;
SQL
)

# Latched rules in scope: the tenant's rules (with --device, the ones using it)
# that are in the worker's latched set.
LATCHED_IDS=$(redis SMEMBERS rules:latched | grep -E '^[0-9a-f-]{36}$' | paste -sd, - || true)
LATCHED=()
[ -z "$LATCHED_IDS" ] || mapfile -t LATCHED < <(qs -v ids="$LATCHED_IDS" <<'SQL'
SELECT r.id FROM rules r
 WHERE r.tenant_id = :'tid'
   AND r.id::text = ANY (string_to_array(:'ids', ','))
   AND (:'did' = '' OR EXISTS (SELECT 1 FROM rule_devices rd WHERE rd.rule_id = r.id AND rd.device_id::text = :'did'));
SQL
)

# Retained desired state: one topic filter for the tenant, or one for the device.
if [ -n "$DEVICE_ID" ]; then STATE_TOPICS=("$TENANT_SLUG/$DEVICE_SLUG/state/#"); else STATE_TOPICS=("$TENANT_SLUG/+/state/#"); fi

echo "Target:  $WHERE"
echo "Tenant:  $TENANT_NAME ($TENANT_SLUG, $TENANT_ID)"
echo "Scope:   $SCOPE"
echo "Deletes:"
echo "  telemetry rows      $ROWS from $DEVICES device(s)${FIRST:+, $FIRST → $LAST}"
echo "  latest values       $HEALTH"
echo "  notifications       $NOTIFS"
echo "  rule activity       $RUNS runs, $ACTIONS actions"
echo "  commands            $COMMANDS, and retained desired state under ${STATE_TOPICS[*]}"
echo "  device status       $STATUSES device(s) back to Never connected"
echo "  latched rules       ${#LATCHED[@]} reset"

if [ "$((ROWS + HEALTH + NOTIFS + RUNS + COMMANDS + STATUSES + ${#LATCHED[@]}))" = "0" ]; then
  echo "Nothing recorded in the database. Clearing retained desired state only."
fi

if [ -z "$YES" ]; then
  PHRASE="delete $TENANT_SLUG"
  echo "This cannot be undone.$( [ "$ENV" = prod ] && echo ' Take a backup first (infra/backups/backup.sh) if the data might be needed.')"
  read -rp "Type '${PHRASE}' to continue: " ans </dev/tty
  [ "$ans" = "$PHRASE" ] || { echo "Aborted."; exit 1; }
fi

if [ "${#LATCHED[@]}" -gt 0 ]; then
  echo "==> Resetting ${#LATCHED[@]} latched rule(s)"
  # What POST /rules/{id}/reset publishes (rules.service.request_latch_reset):
  # the worker clears the rule's latch in memory and in the rules:latched set.
  for rid in "${LATCHED[@]}"; do
    redis PUBLISH rules:manual "{\"tenant_id\":\"$TENANT_ID\",\"rule_id\":\"$rid\",\"trigger_source\":\"reset\"}" >/dev/null
  done
fi

echo "==> Deleting from the database"
# action_executions go with their rule_executions (ON DELETE CASCADE); one that
# points at a deleted command keeps its row with command_id set to NULL.
qs <<SQL
BEGIN;
DELETE FROM telemetry WHERE $FILTER;
DELETE FROM device_metric_health WHERE $FILTER;
DELETE FROM notifications WHERE $FILTER;
DELETE FROM rule_executions WHERE $FILTER;
DELETE FROM commands WHERE $FILTER;
UPDATE devices
   SET last_seen_at = NULL, last_status_at = NULL, last_status_online = NULL,
       rssi = NULL, battery_pct = NULL, uptime_s = NULL, fw_version = NULL
 WHERE tenant_id = :'tid' AND (:'did' = '' OR id::text = :'did');
COMMIT;
SQL

echo "==> EMQX: clearing retained desired state"
for topic in "${STATE_TOPICS[@]}"; do
  $COMPOSE exec -T emqx emqx ctl retainer clean "$topic" >/dev/null \
    || echo "   (couldn't clear $topic — retainer not active?)"
done

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

IFS='|' read -r LEFT_ROWS LEFT_NOTIFS LEFT_RUNS LEFT_COMMANDS < <(qs <<SQL
SELECT (SELECT count(*) FROM telemetry WHERE $FILTER), (SELECT count(*) FROM notifications WHERE $FILTER),
       (SELECT count(*) FROM rule_executions WHERE $FILTER), (SELECT count(*) FROM commands WHERE $FILTER);
SQL
)
echo "Done. Left for this scope: $LEFT_ROWS telemetry rows, $LEFT_NOTIFS notifications, $LEFT_RUNS rule runs, $LEFT_COMMANDS commands"
