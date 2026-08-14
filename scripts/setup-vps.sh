#!/usr/bin/env bash
#
# setup-vps.sh — provision a fresh Ubuntu 24.04 VPS as an iot-saas production host.
#
# Run ONCE, as root (or via sudo), on a brand-new VPS before the first deploy:
#   ssh root@your-vps-ip
#   curl -fsSL https://raw.githubusercontent.com/<you>/iot-saas/main/scripts/setup-vps.sh -o setup-vps.sh
#   bash setup-vps.sh
# ...or copy the repo up first and run it from there. Safe to re-run — every step
# is idempotent — but it is a HOST-level script: it changes firewall rules, SSH
# config, and installs system packages. Read it before running it on a box you
# care about.
#
# What it does NOT do: clone the repo, write infra/.env, issue TLS certificates,
# or start the application stack. That's infra/PROD_DEPLOY.md, step by step,
# after this script finishes. This script only gets the bare host ready.
#
# Assumes: a fresh Ubuntu 24.04 droplet/instance, root SSH access, and that you
# already added your SSH public key when the VPS was created (DigitalOcean,
# Hetzner, Linode and most providers do this at creation time). If you didn't,
# stop and add one now — this script will end by locking out password auth.

set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SSH_PORT="${SSH_PORT:-22}"

log()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  ! \033[0m%s\n' "$*"; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this as root (sudo bash setup-vps.sh)."

if ! grep -qi 'ubuntu' /etc/os-release 2>/dev/null || ! grep -q '24.04' /etc/os-release 2>/dev/null; then
  warn "This doesn't look like Ubuntu 24.04 — continuing anyway, but commands may not match."
fi

# ── 1. System packages + unattended security updates ───────────────────────
log "Updating apt and installing base packages"
apt-get update -y
apt-get upgrade -y
apt-get install -y \
  ca-certificates curl gnupg git ufw fail2ban unattended-upgrades \
  apt-transport-https software-properties-common
ok "Base packages installed"

log "Enabling unattended security upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades
ok "unattended-upgrades enabled (security patches apply automatically)"

# ── 2. Swap file ─────────────────────────────────────────────────────────────
# TimescaleDB + EMQX + the app containers on a small/mid VPS (2-4GB RAM) benefit
# from swap headroom so a transient memory spike degrades instead of OOM-killing
# a container. 2G is enough to absorb spikes without masking a real leak.
if [ ! -f /swapfile ]; then
  log "Creating 2G swap file"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "Swap enabled ($(swapon --show=SIZE --noheadings /swapfile 2>/dev/null))"
else
  ok "Swap file already present"
fi

# ── 3. Non-root deploy user ─────────────────────────────────────────────────
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  log "Creating user '$DEPLOY_USER'"
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  usermod -aG sudo "$DEPLOY_USER"
  mkdir -p "/home/$DEPLOY_USER/.ssh"
  if [ -f /root/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
  fi
  chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
  chmod 700 "/home/$DEPLOY_USER/.ssh"
  chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys" 2>/dev/null || true
  ok "User '$DEPLOY_USER' created, sudo-enabled, root's authorized_keys copied over"
else
  ok "User '$DEPLOY_USER' already exists"
fi

if [ ! -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ]; then
  die "No authorized_keys for '$DEPLOY_USER'. Add your SSH public key to /home/$DEPLOY_USER/.ssh/authorized_keys before continuing — the next step disables password auth, and you must not lock yourself out."
fi

# ── 4. Firewall (ufw) ───────────────────────────────────────────────────────
# Deny everything inbound except: SSH, HTTP/HTTPS (nginx + ACME), MQTT-over-TLS
# (devices talk to EMQX here). Plain MQTT (1883) and the EMQX dashboard (18083)
# are deliberately NOT opened — 1883 is worker-to-broker only, over the internal
# Docker network, never published to the host; the dashboard is reached over an
# SSH tunnel (see infra/PROD_DEPLOY.md).
log "Configuring ufw firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_PORT}/tcp" comment 'SSH'
ufw allow 80/tcp   comment 'HTTP (ACME challenge + redirect to HTTPS)'
ufw allow 443/tcp  comment 'HTTPS'
ufw allow 8883/tcp comment 'MQTT over TLS (devices)'
ufw --force enable
ok "ufw enabled: $(ufw status | tr '\n' ' ')"

log "Configuring fail2ban for sshd"
cat > /etc/fail2ban/jail.local <<EOF
[sshd]
enabled = true
port = ${SSH_PORT}
maxretry = 5
bantime = 1h
findtime = 10m
EOF
systemctl enable --now fail2ban
ok "fail2ban active on sshd"

# ── 5. SSH hardening ────────────────────────────────────────────────────────
log "Hardening sshd (no root login, no password auth, key-based only)"
SSHD_CONF=/etc/ssh/sshd_config.d/99-iot-saas-hardening.conf
cat > "$SSHD_CONF" <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
X11Forwarding no
Port ${SSH_PORT}
EOF
sshd -t || die "sshd config test failed — check $SSHD_CONF before restarting sshd"
systemctl reload ssh
ok "sshd hardened and reloaded. Root login and password auth are now OFF."
warn "Keep your current SSH session open until you've verified you can log in as"
warn "'$DEPLOY_USER' from a NEW terminal — if that fails, fix it from this session."

# ── 6. Docker Engine + Compose plugin (official repo, not snap/apt default) ─
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine + Compose plugin"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  ok "Docker $(docker --version)"
else
  ok "Docker already installed: $(docker --version)"
fi

usermod -aG docker "$DEPLOY_USER"
ok "'$DEPLOY_USER' added to the docker group (takes effect on next login)"

systemctl enable --now docker
ok "Docker daemon enabled at boot"

# ── 7. Verification summary ─────────────────────────────────────────────────
log "Summary"
printf '  %-16s %s\n' "deploy user:"  "$DEPLOY_USER"
printf '  %-16s %s\n' "ssh port:"     "$SSH_PORT"
printf '  %-16s %s\n' "docker:"       "$(docker --version 2>/dev/null || echo MISSING)"
printf '  %-16s %s\n' "compose:"      "$(docker compose version --short 2>/dev/null || echo MISSING)"
printf '  %-16s %s\n' "firewall:"     "$(ufw status | head -1)"
printf '  %-16s %s\n' "swap:"         "$(swapon --show=SIZE --noheadings 2>/dev/null | tr '\n' ' ')"

cat <<NEXT

────────────────────────────────────────────────────────────────────────────
Next steps
────────────────────────────────────────────────────────────────────────────
1. From your OWN machine, in a NEW terminal (leave this session open until
   this succeeds):
     ssh -p ${SSH_PORT} ${DEPLOY_USER}@2.25.104.233

2. Point DNS A records at this VPS's IP for both:
     app.yourdomain.com   (frontend)
     api.yourdomain.com   (backend)

3. Continue with infra/PROD_DEPLOY.md from "Clone the repo" onward.
NEXT

ok "VPS base provisioning complete."
