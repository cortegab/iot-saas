#!/usr/bin/env bash
#
# setup-wsl.sh — provision a WSL Ubuntu 24.04 environment for iot-saas development.
#
# Installs the developer toolchain the stack needs:
#   - build essentials, git, curl, mosquitto-clients (device simulation)
#   - uv  (manages Python 3.12 + the backend virtualenv)
#   - Node.js 20 LTS + pnpm 9 (frontend, OpenAPI codegen)
#
# It does NOT install Docker: you already run Docker Desktop on Windows, and the
# correct pattern for WSL is to expose that engine via Docker Desktop's WSL
# integration (Settings → Resources → WSL Integration → enable your distro),
# not to run a second engine inside WSL. The script verifies Docker is reachable
# and tells you what to do if it isn't.
#
# Usage (from inside WSL):
#   bash scripts/setup-wsl.sh
#
# Safe to re-run — each step is idempotent.

set -euo pipefail

PNPM_VERSION="9.15.9"
NODE_MAJOR="20"

log()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  ! \033[0m%s\n' "$*"; }

# ── 0. Sanity: are we actually in WSL? ──────────────────────────────────────
if ! grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null; then
  warn "This doesn't look like WSL. The script targets WSL Ubuntu 24.04 — continue at your own risk."
fi

# ── 1. Base system packages ─────────────────────────────────────────────────
log "Updating apt and installing base packages"
sudo apt-get update -y
sudo apt-get install -y \
  ca-certificates \
  curl \
  git \
  build-essential \
  mosquitto-clients   # provides mosquitto_pub / mosquitto_sub (NOT the broker)
ok "Base packages installed (git, curl, build-essential, mosquitto-clients)"

# ── 2. uv (Python toolchain) ────────────────────────────────────────────────
# uv installs and pins Python 3.12 for the backend, and manages the virtualenv.
if ! command -v uv >/dev/null 2>&1; then
  log "Installing uv"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  # Make uv available in THIS shell; the installer also adds it to ~/.bashrc.
  export PATH="$HOME/.local/bin:$PATH"
else
  log "uv already present — upgrading"
  uv self update || true
fi
ok "uv $(uv --version 2>/dev/null | awk '{print $2}')"

# ── 3. Node.js 20 LTS + pnpm ────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt "$NODE_MAJOR" ]; then
  log "Installing Node.js ${NODE_MAJOR} LTS (NodeSource)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
else
  ok "Node.js $(node -v) already installed"
fi

log "Enabling pnpm ${PNPM_VERSION} via corepack"
sudo corepack enable
corepack prepare "pnpm@${PNPM_VERSION}" --activate
ok "pnpm $(pnpm --version)"

# ── 4. Docker check (not installed here — Docker Desktop provides it) ────────
log "Checking Docker availability"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ok "Docker reachable: $(docker --version)"
  if docker compose version >/dev/null 2>&1; then
    ok "Docker Compose: $(docker compose version --short 2>/dev/null || echo present)"
  else
    warn "Docker found but 'docker compose' is missing — update Docker Desktop."
  fi
else
  warn "Docker is NOT reachable from WSL."
  warn "Fix: Docker Desktop → Settings → Resources → WSL Integration →"
  warn "     toggle ON your Ubuntu 24.04 distro, then Apply & Restart."
  warn "Do NOT 'apt install docker' — that starts a second, conflicting engine."
fi

# ── 5. Claude Code (the dev agent) ──────────────────────────────────────────

# 5a. Browser opener for WSL. Without this, WSL has no default browser, so
# Claude Code's OAuth login page (and any other URL) silently fails to open.
# wslu provides `wslview`, which opens the Windows default browser.
if grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null; then
  if ! command -v wslview >/dev/null 2>&1; then
    log "Installing wslu (lets WSL open the Windows browser)"
    sudo apt-get install -y wslu
  fi
  if ! grep -q 'BROWSER=wslview' "$HOME/.bashrc" 2>/dev/null; then
    echo 'export BROWSER=wslview' >> "$HOME/.bashrc"
  fi
  export BROWSER=wslview
  ok "Browser opener ready (BROWSER=wslview)"
fi

# 5b. Native installer: no sudo, installs to ~/.local/bin, auto-updates in the
# background. (The npm package would require Node 22+, and we install Node 20 for
# the frontend — so the native installer is the clean choice here.)
log "Installing Claude Code (native installer)"
if command -v claude >/dev/null 2>&1; then
  ok "Claude Code already installed: $(claude --version 2>/dev/null)"
else
  curl -fsSL https://claude.ai/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"
  if command -v claude >/dev/null 2>&1; then
    ok "Claude Code installed: $(claude --version 2>/dev/null)"
  else
    warn "claude not on PATH yet — restart your shell (it installs to ~/.local/bin)"
  fi
fi

# ── 6. Verification summary ─────────────────────────────────────────────────
log "Toolchain versions"
printf '  %-10s %s\n' "python:" "$(uv run --no-project python --version 2>/dev/null || echo 'via uv')"
printf '  %-10s %s\n' "uv:"      "$(uv --version 2>/dev/null || echo MISSING)"
printf '  %-10s %s\n' "node:"    "$(node -v 2>/dev/null || echo MISSING)"
printf '  %-10s %s\n' "pnpm:"    "$(pnpm --version 2>/dev/null || echo MISSING)"
printf '  %-10s %s\n' "mqtt:"    "$(mosquitto_pub --help 2>&1 | head -1 || echo MISSING)"
printf '  %-10s %s\n' "docker:"  "$(docker --version 2>/dev/null || echo 'not reachable')"
printf '  %-10s %s\n' "claude:"  "$(claude --version 2>/dev/null || echo 'restart shell to load PATH')"

cat <<'NEXT'

──────────────────────────────────────────────────────────────────────────────
Next steps
──────────────────────────────────────────────────────────────────────────────
1. Restart your shell (or: source ~/.bashrc) so uv is on PATH permanently.

2. Project location — performance matters:
   Your repo currently lives on the Windows drive, reachable at
     /mnt/c/AIProjects/IoT\ Platform/iot-saas
   That works, but hot-reload file-watching (uvicorn --reload, next dev) is
   slow and unreliable across the /mnt/c mount. For a smooth dev loop, keep the
   project inside the Linux filesystem (e.g. ~/iot-saas) instead.
   NOTE: the backend/frontend/infra scaffolding is not on GitHub yet, so a fresh
   `git clone` would miss it — copy from /mnt/c or push it first.

3. Bring up the stack:
     cd <project>/  &&  cp infra/.env.example infra/.env
     docker compose -f infra/docker-compose.yml up -d --build

4. Simulate a device (mosquitto is now installed):
     mosquitto_pub -h localhost -p 1883 -t "demo/sensor01/temperature" -m '{"value":31.5}'
     docker compose -f infra/docker-compose.yml exec -T redis redis-cli XLEN telemetry

5. Backend dev outside containers (tests, lint, migrations):
     cd backend && uv sync && uv run pytest && uv run ruff check . && uv run mypy src/app

6. Start Claude Code from the project directory and authenticate:
     claude
   First run opens a browser to log in. Requires a Claude Pro/Max/Team/Enterprise
   or Console account — the free Claude.ai plan does not include Claude Code.
NEXT

ok "WSL setup complete."
