# Production deployment — Ubuntu 24.04 VPS

Step-by-step, first-deploy-to-verified-working. Follows CLAUDE.md §1's constraint: single Linux VPS,
Docker Compose, one person can operate and debug it at 3am. Every command below is meant to be run in
order — later steps assume earlier ones succeeded.

**Before you start:**
- A VPS running Ubuntu 24.04 with root SSH access (2 vCPU / 4GB RAM is a reasonable floor for the
  500–1,000 device design point in CLAUDE.md §1; go bigger if you're closer to that ceiling on day one).
- A domain you control, able to add DNS A records.
- This repo pushed somewhere you can `git clone` from the VPS (a private GitHub repo + a deploy key,
  or `git pull` over SSH from your own machine — either works).

---

## 1. Provision the VPS

```bash
ssh root@2.25.104.233
```

Copy `scripts/setup-vps.sh` up (`scp scripts/setup-vps.sh root@2.25.104.233:` from your machine, or
`git clone` the repo as root temporarily) and run it:

```bash
bash setup-vps.sh
```

This creates a non-root `deploy` user, enables the firewall (only SSH/80/443/8883 open — see the
script's comments for why 1883 and the EMQX dashboard stay closed), turns on fail2ban and unattended
security upgrades, adds a 2G swap file, installs Docker, and disables SSH password auth. Read
`scripts/setup-vps.sh` before running it — it changes SSH access on a box you don't want to get
locked out of.

**Verify you can log in as `deploy` from a new terminal before closing your root session:**

```bash
ssh deploy@2.25.104.233
```

---

## 2. DNS

Point three A records at the VPS's IP:

| Record | Purpose |
|---|---|
| `app.yourdomain.com` | frontend |
| `api.yourdomain.com` | backend (REST + WebSocket) |
| `mqtt.yourdomain.com` | EMQX, for devices' TLS SNI/hostname verification |

They share one TLS certificate (one cert, three SANs — see step 6), so all three must resolve before
that step. DNS propagation can take a few minutes to a few hours depending on your registrar/TTL —
confirm with `dig +short app.yourdomain.com` before moving on.

---

## 3. Clone the repo

```bash
git clone <your-repo-url> ~/iot-saas
cd ~/iot-saas
```

Deploy from a tagged release or a specific commit, not a moving branch, so you always know exactly
what's running:

```bash
git checkout <tag-or-commit>
```

---

## 4. Production secrets

```bash
cp infra/.env.prod.example infra/.env.prod
chmod 600 infra/.env.prod
```

Edit `infra/.env.prod`: fill in the three domains and your email (for Let's Encrypt renewal
notices), then replace every `CHANGE_ME` with a real value — `openssl rand -hex 32` per secret, a
**different** value each time. Do not reuse a value across two `CHANGE_ME` slots, and do not reuse
any dev secret from `infra/.env`.

`infra/.env.prod` is git-ignored (see `.gitignore`) — unlike the dev `.env` files in this repo, it
must never be committed. Its permissions (`chmod 600`) matter too; it's the credential, not just a
config file.

---

## 5. Bootstrap the `iot_app` Postgres role

CLAUDE.md §8's rule applies here too: the app connects as a non-superuser (`iot_app`) so Row-Level
Security actually applies — the compose superuser (`iot`) is for migrations only. Bring up just the
database first:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d timescaledb
```

Wait for it to report healthy (`docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod ps`), then create the role — **use the same password you put in `APP_DATABASE_URL` in `infra/.env.prod`**, not the placeholder shown here:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec timescaledb \
  psql -U iot -d iot -c "CREATE ROLE iot_app LOGIN PASSWORD '<same password as APP_DATABASE_URL>' NOSUPERUSER NOBYPASSRLS;"
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec timescaledb \
  psql -U iot -d iot -c "GRANT CONNECT ON DATABASE iot TO iot_app;"
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec timescaledb \
  psql -U iot -d iot -c "GRANT USAGE ON SCHEMA public TO iot_app;"
```

Per-table grants and RLS policies are issued by each table's own Alembic migration (step 8) — nothing
further to do here.

---

## 6. Render config and bring the stack up (HTTP only, for now)

Generate the two files that bake in your real domains/secrets and therefore aren't in git:

```bash
bash scripts/render-prod-config.sh
```

nginx's real config has `listen 443 ssl` blocks pointing at a certificate that doesn't exist yet on a
fresh host, so for this first boot, swap in the HTTP-only bootstrap config instead:

```bash
DOMAIN_APP=$(grep ^DOMAIN_APP infra/.env.prod | cut -d= -f2) \
DOMAIN_API=$(grep ^DOMAIN_API infra/.env.prod | cut -d= -f2) \
  envsubst '${DOMAIN_APP} ${DOMAIN_API}' \
  < infra/nginx/conf.d/bootstrap.conf.template > infra/nginx/conf.d/iot-saas.conf
```

Now build and start everything:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod ps
```

Wait for `timescaledb`, `redis`, and `emqx` to be healthy. Confirm nginx is answering:

```bash
curl http://app.yourdomain.com
# → "iot-saas: awaiting TLS certificate issuance"
```

---

## 7. Issue the TLS certificate

One certificate, five SANs — `DOMAIN_API` first, because the nginx and EMQX configs both point at
`/etc/letsencrypt/live/<DOMAIN_API>/` and certbot names the lineage directory after the first `-d`.
The apex (`DOMAIN_APP`) plus its `www.` and `app.` hostnames are all included so nginx can serve the
apex and redirect the other two. A DNS A record must exist for each name before issuance.

```bash
source infra/.env.prod
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod \
  --profile certbot run --rm certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN_API" -d "$DOMAIN_APP" -d "www.$DOMAIN_APP" -d "app.$DOMAIN_APP" -d "$DOMAIN_MQTT" \
  --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email
```

If this fails, it's almost always DNS not having propagated yet for one of the names, or port 80 not
reachable from the internet (check `ufw status` and that no other process is bound to 80 on the host).

To **add the apex/www/app names to an existing cert** (e.g. after migrating `DOMAIN_APP` from an
`app.` subdomain to the apex), re-run the same command with `--cert-name "$DOMAIN_API" --expand`
added — this keeps the lineage path so nothing in nginx/EMQX changes — then
`bash scripts/render-prod-config.sh && docker compose ... exec nginx nginx -s reload`.

---

## 8. Switch to the real config and run migrations

```bash
bash scripts/render-prod-config.sh   # overwrites the bootstrap conf with the real, TLS-enabled one
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod restart nginx emqx
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec api uv run alembic upgrade head
```

Restarting `emqx` picks up the freshly issued certificate for its 8883 TLS listener (see
`infra/emqx/emqx.prod.conf.template`'s comment for why a restart, not a hot reload, is required).

---

## 9. Verify

```bash
curl -s https://api.yourdomain.com/health          # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' https://app.yourdomain.com
```

Open `https://app.yourdomain.com`, register the first account (`/auth/register`, then create a tenant
via `/tenants` — normally both happen through the signup flow in the UI), and register a device.
Simulate telemetry from your own machine, over TLS this time:

```bash
mosquitto_pub -h mqtt.yourdomain.com -p 8883 --cafile /etc/ssl/certs/ca-certificates.crt \
  -u <device_id> -P <device_token> -t "<tenant>/<device>/temperature" -m '{"value":31.5}'
```

It should appear on the live dashboard within a second or two. If a rule is armed on that metric,
watch the corresponding actuator command:

```bash
mosquitto_sub -h mqtt.yourdomain.com -p 8883 --cafile /etc/ssl/certs/ca-certificates.crt \
  -u <device_id> -P <device_token> -t "<tenant>/<device>/cmd/#"
```

---

## 10. Backups and certificate renewal — on a schedule, not by hand

```bash
sudo cp infra/backups/iot-saas-backup.service infra/backups/iot-saas-backup.timer \
        infra/backups/iot-saas-cert-renew.service infra/backups/iot-saas-cert-renew.timer \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now iot-saas-backup.timer iot-saas-cert-renew.timer
```

Adjust `WorkingDirectory=` in the two `.service` files first if the repo isn't at
`/home/deploy/iot-saas`. Then:

1. Run `bash infra/backups/backup.sh` once by hand and confirm a `.dump` file lands in
   `/var/backups/iot-saas/`.
2. Set `RCLONE_REMOTE` in the environment (or edit the script's default) so backups leave the host —
   see `infra/backups/backup.sh`'s header comment. A backup that only exists on the VPS you're
   protecting against isn't a backup.
3. Do the restore rehearsal in `infra/backups/RESTORE_RUNBOOK.md` now, before you need it for real.

---

## 11. Ongoing operations

**Deploying a change** (this is what `.github/workflows/deploy-prod.yml` automates on push to `prod`):

```bash
cd ~/iot-saas
git fetch && git checkout <new-tag-or-commit>
C="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"
$C up -d --build
bash scripts/render-prod-config.sh          # apply any nginx/emqx .template change in this commit
$C exec api uv run alembic upgrade head
$C exec nginx nginx -s reload                # up -d recreates api/frontend with new IPs — nginx
                                             # caches the old ones and 502s until reloaded
```

**Logs:**

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod logs -f worker
```

**EMQX dashboard (never exposed publicly — tunnel to it):**

```bash
ssh -L 18083:localhost:18083 deploy@2.25.104.233
# then open http://localhost:18083 on your own machine
```

**Rotating a secret:** edit `infra/.env.prod`, re-run `bash scripts/render-prod-config.sh` if the
changed value was `EMQX_AUTH_SHARED_SECRET`, `EMQX_NODE_COOKIE`, or a domain, then
`docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d` to apply.

**Reboots:** every service is `restart: always` and Docker is enabled at boot (`setup-vps.sh` step
6), so a provider maintenance reboot recovers on its own — verify once after the first real reboot
rather than assuming it.
