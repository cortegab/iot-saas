#!/usr/bin/env bash
#
# renew-certs.sh — renew the Let's Encrypt certificate (no-op if not due
# within 30 days) and reload the services that hold it open: nginx (graceful
# reload, no downtime) and EMQX (full container restart — its MQTT TLS
# listener has no live cert-reload hook, so devices reconnect, which their
# TLS client should already handle since EMQX itself restarts on redeploys
# too). Named "certbot renew" is idempotent — safe to run daily.
#
# Install on a timer (see iot-saas-cert-renew.service/.timer in this
# directory) rather than relying on someone remembering to run it.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="docker compose -f $ROOT_DIR/infra/docker-compose.prod.yml --env-file $ROOT_DIR/infra/.env.prod"

echo "==> certbot renew"
$COMPOSE --profile certbot run --rm certbot renew --webroot -w /var/www/certbot

echo "==> Reloading nginx"
$COMPOSE exec -T nginx nginx -s reload

echo "==> Restarting emqx to pick up the (possibly renewed) certificate"
$COMPOSE restart emqx

echo "==> Done."
