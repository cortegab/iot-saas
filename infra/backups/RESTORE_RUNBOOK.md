# Restore runbook

CLAUDE.md's rule: "a backup that has never been restored is not a backup." Run this drill after
first setting up backups, and again every few months — a backup process can silently rot (wrong
credentials, a schema change pg_restore can't apply, a cron job that stopped firing) without ever
producing an error on the backup side.

## Rehearse on a scratch database (do this first, and periodically — no impact on production)

```bash
# 1. Take a real backup.
bash infra/backups/backup.sh

# 2. Spin up a throwaway TimescaleDB container — NOT the production one.
docker run -d --name iot-restore-test \
  -e POSTGRES_USER=iot -e POSTGRES_PASSWORD=test -e POSTGRES_DB=iot \
  timescale/timescaledb:2.17.2-pg16

# 3. Copy the dump in and restore it there.
docker cp /var/backups/iot-saas/iot-<timestamp>.dump iot-restore-test:/tmp/restore.dump
docker exec iot-restore-test psql -U iot -d iot -c "SELECT timescaledb_pre_restore();"
docker exec iot-restore-test pg_restore -U iot -d iot --clean --if-exists --no-owner /tmp/restore.dump
docker exec iot-restore-test psql -U iot -d iot -c "SELECT timescaledb_post_restore();"

# 4. Verify — row counts on a couple of tables, hypertable list, most recent telemetry timestamp.
docker exec iot-restore-test psql -U iot -d iot -c "SELECT * FROM timescaledb_information.hypertables;"
docker exec iot-restore-test psql -U iot -d iot -c "SELECT max(time) FROM telemetry;"
docker exec iot-restore-test psql -U iot -d iot -c "SELECT count(*) FROM tenants;"

# 5. Tear down the scratch container.
docker rm -f iot-restore-test
```

If any step fails, the backup process is broken — fix it now, not during an actual incident.

## Real restore (production is down or corrupted)

1. Confirm you're restoring into the right place: check `infra/.env.prod`'s `POSTGRES_DB` matches
   what you expect, and that you have the right dump file (`ls -lt /var/backups/iot-saas/`, or pull
   the latest from the off-host `rclone` remote if the local disk is what's gone:
   `rclone copy offsite:iot-saas-backups /var/backups/iot-saas/ --include "iot-<date>*"`).
2. Stop the app so nothing writes to the database mid-restore:
   ```bash
   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod stop api worker
   ```
3. Run the restore:
   ```bash
   bash infra/backups/restore.sh /var/backups/iot-saas/iot-<timestamp>.dump
   ```
4. Verify (same queries as the rehearsal step above), then bring the app back:
   ```bash
   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod start api worker
   ```
5. Check `/health` on the API and that a simulated device publish shows up on the dashboard within
   a couple of seconds (infra/PROD_DEPLOY.md's verification checklist) before declaring the incident
   over.

## What this restores — and what it doesn't

- Covers: `tenants`, `users`, `devices`, `dashboards`, `rules`, `commands`, `api_keys`,
  `subscriptions`, and the `telemetry` hypertable (raw + continuous aggregates), since `pg_dump -Fc`
  captures the whole database.
- Does NOT cover: EMQX's own state (device MQTT credentials are derived from `devices`/`api_keys` via
  the HTTP auth callbacks, not stored separately in EMQX, so a DB restore is sufficient) or Redis
  (purely cache/stream/pub-sub — safe to lose; the worker rebuilds the rule cache from Postgres on
  startup and in-flight stream entries are, at worst, a few seconds of telemetry not yet flushed).
- Point-in-time: this is a full daily/periodic snapshot, not continuous WAL archiving — restoring
  loses writes since the last successful `backup.sh` run. Accepted per CLAUDE.md's "minutes, not
  seconds" RTO/RPO for this deployment scale; revisit if that stops being acceptable.
