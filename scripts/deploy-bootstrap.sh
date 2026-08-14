#!/usr/bin/env bash
#
# deploy-bootstrap.sh — first-boot production bootstrap for iodriven.tech.
#
# Covers infra/PROD_DEPLOY.md steps 4-6: production secrets, the `iot_app`
# Postgres role, and bringing the stack up over HTTP (no TLS cert exists yet
# on a fresh host — that's step 7, run separately once DNS has propagated).
#
# Run from the repo root on the VPS, as the `deploy` user:
#   bash scripts/deploy-bootstrap.sh
#
# Safe to re-run: if infra/.env.prod already exists, secret generation is
# skipped so existing secrets are never regenerated or overwritten.

set -euo pipefail

DOMAIN_APP="app.iodriven.tech"
DOMAIN_API="api.iodriven.tech"
DOMAIN_MQTT="mqtt.iodriven.tech"
LETSENCRYPT_EMAIL="cesar.ortegabailon@gmail.com"

COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"

# ── Step 4 — production secrets ─────────────────────────────────────────────
if [ -f infra/.env.prod ]; then
  echo "infra/.env.prod already exists — skipping secret generation."
else
  echo "Generating infra/.env.prod"
  cp infra/.env.prod.example infra/.env.prod
  chmod 600 infra/.env.prod

  PG_PW=$(openssl rand -hex 32)
  APP_PW=$(openssl rand -hex 32)
  EMQX_COOKIE=$(openssl rand -hex 32)
  EMQX_DASH_PW=$(openssl rand -hex 32)
  JWT_KEY=$(openssl rand -hex 32)
  EMQX_SHARED=$(openssl rand -hex 32)
  MQTT_WORKER_PW=$(openssl rand -hex 32)

  sed -i \
    -e "s/DOMAIN_APP=.*/DOMAIN_APP=${DOMAIN_APP}/" \
    -e "s/DOMAIN_API=.*/DOMAIN_API=${DOMAIN_API}/" \
    -e "s/DOMAIN_MQTT=.*/DOMAIN_MQTT=${DOMAIN_MQTT}/" \
    -e "s/LETSENCRYPT_EMAIL=.*/LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL}/" \
    -e "s#NEXT_PUBLIC_API_URL=.*#NEXT_PUBLIC_API_URL=https://${DOMAIN_API}#" \
    -e "s/POSTGRES_PASSWORD=CHANGE_ME/POSTGRES_PASSWORD=${PG_PW}/" \
    -e "s#DATABASE_URL=postgresql+asyncpg://iot:CHANGE_ME@#DATABASE_URL=postgresql+asyncpg://iot:${PG_PW}@#" \
    -e "s#APP_DATABASE_URL=postgresql+asyncpg://iot_app:CHANGE_ME@#APP_DATABASE_URL=postgresql+asyncpg://iot_app:${APP_PW}@#" \
    -e "s/EMQX_NODE_COOKIE=CHANGE_ME/EMQX_NODE_COOKIE=${EMQX_COOKIE}/" \
    -e "s/EMQX_DASHBOARD_PASSWORD=CHANGE_ME/EMQX_DASHBOARD_PASSWORD=${EMQX_DASH_PW}/" \
    -e "s/JWT_SECRET_KEY=CHANGE_ME/JWT_SECRET_KEY=${JWT_KEY}/" \
    -e "s/EMQX_AUTH_SHARED_SECRET=CHANGE_ME/EMQX_AUTH_SHARED_SECRET=${EMQX_SHARED}/" \
    -e "s/MQTT_WORKER_PASSWORD=CHANGE_ME/MQTT_WORKER_PASSWORD=${MQTT_WORKER_PW}/" \
    infra/.env.prod

  echo "infra/.env.prod populated (values not shown)."
fi

# ── Step 5 — bootstrap the iot_app Postgres role ────────────────────────────
echo "Starting timescaledb"
$COMPOSE up -d timescaledb

echo "Waiting for timescaledb to report healthy..."
until $COMPOSE ps timescaledb | grep -q "healthy"; do
  sleep 3
done

APP_PW_CURRENT=$(grep '^APP_DATABASE_URL=' infra/.env.prod | sed -E 's#.*iot_app:([^@]+)@.*#\1#')

if $COMPOSE exec -T timescaledb psql -U iot -d iot -tAc "SELECT 1 FROM pg_roles WHERE rolname='iot_app'" | grep -q 1; then
  echo "Role iot_app already exists — skipping creation."
else
  $COMPOSE exec -T timescaledb \
    psql -U iot -d iot -c "CREATE ROLE iot_app LOGIN PASSWORD '${APP_PW_CURRENT}' NOSUPERUSER NOBYPASSRLS;"
  $COMPOSE exec -T timescaledb \
    psql -U iot -d iot -c "GRANT CONNECT ON DATABASE iot TO iot_app;"
  $COMPOSE exec -T timescaledb \
    psql -U iot -d iot -c "GRANT USAGE ON SCHEMA public TO iot_app;"
  echo "Role iot_app created."
fi

# ── Step 6 — render config, swap in the HTTP-only bootstrap nginx conf, boot ─
echo "Rendering production config"
bash scripts/render-prod-config.sh

echo "Swapping in HTTP-only bootstrap nginx conf (no TLS cert exists yet)"
DOMAIN_APP="${DOMAIN_APP}" DOMAIN_API="${DOMAIN_API}" \
  envsubst '${DOMAIN_APP} ${DOMAIN_API}' \
  < infra/nginx/conf.d/bootstrap.conf.template > infra/nginx/conf.d/iot-saas.conf

echo "Building and starting the stack"
$COMPOSE up -d --build
$COMPOSE ps

echo ""
echo "Steps 4-6 complete. Verify with: curl http://${DOMAIN_APP}"
echo "Next: confirm DNS has propagated (dig +short ${DOMAIN_APP} ${DOMAIN_API} ${DOMAIN_MQTT})"
echo "      before running step 7 (TLS certificate issuance)."
