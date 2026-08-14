#!/usr/bin/env bash
#
# render-prod-config.sh — generate the two config files that bake in real
# domain names / secrets and therefore aren't committed to git:
#   infra/nginx/conf.d/iot-saas.conf   (from iot-saas.conf.template)
#   infra/emqx/emqx.prod.conf          (from emqx.prod.conf.template)
#
# Run from the repo root, after infra/.env.prod exists (copy it from
# infra/.env.prod.example and fill in real values first):
#   bash scripts/render-prod-config.sh
#
# Safe to re-run — e.g. after rotating EMQX_AUTH_SHARED_SECRET or changing a
# domain. Re-run it, then `docker compose -f infra/docker-compose.prod.yml
# --env-file infra/.env.prod up -d` to pick up the change.
#
# Uses an explicit envsubst variable whitelist rather than substituting
# everything in the environment — the templates contain EMQX's OWN
# ${username}/${password}/${topic}/${action} placeholders (its request-
# templating syntax, evaluated by EMQX itself at runtime), which must survive
# this render untouched.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/infra/.env.prod"

[ -f "$ENV_FILE" ] || {
  echo "Missing $ENV_FILE — copy infra/.env.prod.example to infra/.env.prod and fill it in first." >&2
  exit 1
}

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for var in DOMAIN_APP DOMAIN_API DOMAIN_MQTT EMQX_NODE_COOKIE EMQX_AUTH_SHARED_SECRET; do
  [ -n "${!var:-}" ] || { echo "infra/.env.prod is missing a value for $var" >&2; exit 1; }
done

echo "Rendering infra/nginx/conf.d/iot-saas.conf"
envsubst '${DOMAIN_APP} ${DOMAIN_API}' \
  < "$ROOT_DIR/infra/nginx/conf.d/iot-saas.conf.template" \
  > "$ROOT_DIR/infra/nginx/conf.d/iot-saas.conf"

echo "Rendering infra/emqx/emqx.prod.conf"
envsubst '${DOMAIN_API} ${EMQX_NODE_COOKIE} ${EMQX_AUTH_SHARED_SECRET}' \
  < "$ROOT_DIR/infra/emqx/emqx.prod.conf.template" \
  > "$ROOT_DIR/infra/emqx/emqx.prod.conf"

echo "Done. Both files are git-ignored — re-run this script after editing a .template file or infra/.env.prod."
