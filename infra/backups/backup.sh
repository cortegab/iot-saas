#!/usr/bin/env bash
#
# backup.sh — dump the production TimescaleDB database to a local file,
# prune old local dumps, and (if configured) push the fresh dump off-host.
#
# Run manually to test, or on a schedule via the systemd timer in this
# directory (iot-saas-backup.service / .timer — see infra/PROD_DEPLOY.md).
#
# A dump that only ever lives on the same disk as the database it backs up is
# not a backup — if the VPS is lost, both go together. RCLONE_REMOTE below is
# optional but strongly recommended: point it at any rclone-supported
# off-host target (S3-compatible bucket, Backblaze B2, another VPS over
# SFTP...) configured once via `rclone config`.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/infra/.env.prod"
COMPOSE="docker compose -f $ROOT_DIR/infra/docker-compose.prod.yml --env-file $ENV_FILE"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/iot-saas}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
# e.g. "offsite:iot-saas-backups" — a remote configured via `rclone config`.
# Leave empty to skip off-host copy (not recommended for anything but testing).
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_file="$BACKUP_DIR/iot-${timestamp}.dump"

echo "==> Dumping ${POSTGRES_DB} to ${dump_file}"
# Custom format (-Fc): compressed, and the only format pg_restore can target
# selectively / in parallel. Captures TimescaleDB's catalog metadata along
# with ordinary tables — no separate hypertable export step needed.
$COMPOSE exec -T timescaledb pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$dump_file"

size=$(du -h "$dump_file" | cut -f1)
echo "==> Wrote ${dump_file} (${size})"

# A dump that only lives on this VPS goes down with it. Unless explicitly
# allowed (BACKUP_ALLOW_LOCAL_ONLY=1, for a test box), a missing off-host copy
# makes this run fail, so the timer/cron reports it instead of passing quietly.
offhost_ok=1
if [ -n "$RCLONE_REMOTE" ]; then
  if command -v rclone >/dev/null 2>&1; then
    echo "==> Copying to ${RCLONE_REMOTE}"
    rclone copy "$dump_file" "$RCLONE_REMOTE"
  else
    echo "RCLONE_REMOTE is set but rclone is not installed — no off-host copy." >&2
    offhost_ok=0
  fi
else
  echo "RCLONE_REMOTE not set — dump stays local only. See this script's header." >&2
  offhost_ok=0
fi

echo "==> Pruning local dumps older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name 'iot-*.dump' -mtime "+${RETENTION_DAYS}" -print -delete

if [ "$offhost_ok" = 0 ] && [ "${BACKUP_ALLOW_LOCAL_ONLY:-0}" != 1 ]; then
  echo "FAILED: the dump was written locally but not copied off this host." >&2
  exit 1
fi
echo "==> Done."
