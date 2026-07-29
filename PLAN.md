# PLAN.md — Staged Development Plan

Nine phases plus a sketched future phase. **Phases 0–6 build `iot-saas`** (the multi-tenant SaaS).
**Phase 7 stands up `iot-dedicated`.** **Phase 8 adds OPC UA** to the dedicated product only.

Backend is **Python 3.12 + FastAPI**; frontend is **Next.js + React + Tailwind**. See CLAUDE.md §4
for why.

Install instructions are **manual** throughout — no provisioning scripts. Commands assume
**Ubuntu 22.04 or 24.04 LTS** on the VPS and a Windows workstation for development.

**Complexity:** S = 1–3 days · M = 4–8 days · L = 1.5–3 weeks (solo, full-time).
Total to a production SaaS (Phases 0–6): roughly **9–12 weeks**.

---

## Dependency graph

```
0 ──► 1 ──► 2 ──► 3 ──► 4 ──► 5 ──► 6 ──► 7 ──► 8
      │     │     ▲     ▲           ▲
      └─────┴─────┘     │           │
                        └───────────┘
```

- **0** blocks everything.
- **3** (rules/actuators) needs **2** (ingestion) — it taps the same message flow.
- **4** (dashboard) needs **1, 2, 3** — it renders devices, telemetry, and rules.
- **5** (billing) needs **1, 4** — quotas need tenants; upgrade flows need UI.
- **7** needs **3, 4, 6** — you copy a *hardened* core, not a half-built one.
- **8** needs **7** — the connector needs a dedicated deployment to point at.

**Do not start Phase 7 early.** Every fix made to `iot-saas` before the copy is a fix you make once
instead of twice.

---

## Budget check ($100/month cap)

| Item | Monthly |
|---|---|
| VPS — 4 vCPU / 8 GB / 160 GB NVMe (Hetzner CPX31 or equivalent) | $18–30 |
| Backup storage (object storage, ~50 GB) | $5–10 |
| Domain (amortized) | $1–2 |
| Email delivery (transactional tier) | $0–15 |
| Stripe | % of revenue, no fixed cost |
| **Total** | **$24–57** |

Comfortable headroom. This **deliberately departs from the older planning docs**, which put the
database on a second VPS ($20–60 extra) — that split is unnecessary at 500–1,000 devices and would
consume most of the budget. Revisit only when Phase 6 monitoring shows sustained resource pressure.

---

## Phase 0 — Foundation & infrastructure

**Complexity: M** · **Depends on: nothing**

**Milestone:** VPS reachable over HTTPS on your domain; Postgres+TimescaleDB, EMQX, and Redis all
running in containers and reachable from a local `psql` / `mosquitto_pub` / `redis-cli`.

### Manual installation

**1. Provision the VPS.** Ubuntu 22.04/24.04 LTS, 4 vCPU / 8 GB RAM minimum. Create a non-root sudo
user, add your SSH key, disable password authentication in `/etc/ssh/sshd_config`.

**2. Firewall.** Open only what is needed:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 8883/tcp && sudo ufw enable
```

Port 8883 is MQTT over TLS. **Do not open 1883** (plaintext MQTT) on the public interface.

**3. Docker Engine + Compose plugin** (official repository, not the Ubuntu package):

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg
```

```bash
sudo install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg && sudo chmod a+r /etc/apt/keyrings/docker.gpg
```

```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

```bash
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

```bash
sudo usermod -aG docker $USER
```

Log out and back in, then verify with `docker run hello-world`.

**4. NGINX and Certbot on the host** (not containerized — simpler certificate renewal):

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

Point your domain's A record at the VPS, then:

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Verify renewal with `sudo certbot renew --dry-run`.

**5. Data services via Docker Compose.** Create `infra/docker-compose.yml` with three services:

- `timescale` — image `timescale/timescaledb:latest-pg16`, named volume for `/var/lib/postgresql/data`, port bound to `127.0.0.1:5432` only
- `emqx` — image `emqx/emqx:latest`, ports 1883 (localhost), 8883 (public, TLS), 18083 (dashboard, localhost only)
- `redis` — image `redis:7-alpine`, `--appendonly yes`, bound to `127.0.0.1:6379`

**Bind every service except MQTT/TLS to localhost.** Reach admin interfaces through an SSH tunnel,
never by exposing the port.

```bash
docker compose -f infra/docker-compose.yml up -d
```

```bash
docker compose exec timescale psql -U postgres -d iot -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
```

**6. Development workstation — Python toolchain.** Install Python 3.12, then `uv`:

```bash
pip install uv
```

Install Node 20 LTS and pnpm for the frontend:

```bash
npm install -g pnpm
```

Install `mosquitto-clients` for MQTT testing (on Windows, use the Mosquitto installer or WSL).

**7. Initialize the repo.** Create the `iot-saas` git repository with the `docs/`, `scripts/`,
`infra/`, and `src/{backend,frontend}` layout from CLAUDE.md §7. Scaffold the backend with `uv init`, configure `ruff`,
`mypy`, and `pytest` in `pyproject.toml`. Add a repo-scoped `CLAUDE.md` and a `.env.example`.

### Deliverables
- Running VPS with TLS, firewall, and three healthy containers
- `iot-saas` repo scaffolded with Python tooling configured
- Documented SSH tunnel commands for admin interfaces

---

## Phase 1 — Backend core

**Complexity: L** · **Depends on: 0**

**Milestone:** register a user, create a tenant, register a device, retrieve its credentials — all
through authenticated REST calls, with RLS proven to block cross-tenant reads.

### Scope
- FastAPI app factory, `pydantic-settings` config, structured logging
- **Auth:** email/password registration and login, JWT access + refresh tokens, argon2id hashing
- **Tenants:** creation on signup, membership, roles (owner/admin/viewer)
- **Row-Level Security:** `tenant_id` on every table, Postgres RLS policies, and a **tenant-context
  dependency** that sets the session variable on every request
- **Devices:** CRUD, per-device credential generation, tokens stored hashed
- **API keys:** for programmatic access, hashed, revocable
- **Alembic migrations** from the first table

### Manual installation
No new server software. Add backend dependencies:

```bash
uv add fastapi uvicorn[standard] sqlalchemy[asyncio] asyncpg alembic pydantic-settings pyjwt argon2-cffi
```

```bash
uv add --dev pytest pytest-asyncio httpx ruff mypy
```

Create the application database and role:

```bash
docker compose exec timescale psql -U postgres -c "CREATE DATABASE iot; CREATE ROLE iot_app LOGIN PASSWORD 'changeme';"
```

Initialize Alembic with the async template:

```bash
uv run alembic init -t async alembic
```

### Critical detail
**Write an explicit test that proves tenant A cannot read tenant B's rows.** Run it against real RLS
policies, not mocks. This test protects the core promise of the SaaS product — write it now, while
there are two tables, not later when there are twenty.

The RLS session variable must be set through the FastAPI dependency on every request. A code path
that grabs a raw engine connection silently bypasses RLS entirely.

### Deliverables
- Authenticated REST API for users, tenants, devices, API keys
- RLS policies with a passing cross-tenant isolation test
- Alembic migration workflow documented in the repo CLAUDE.md

---

## Phase 2 — MQTT ingestion & storage path

**Complexity: M** · **Depends on: 0, 1**

**Milestone:** `mosquitto_pub` to a device topic; the reading lands in TimescaleDB within seconds and
is queryable through the REST API.

### Scope
- **Worker process** (`app/worker.py`) — separate from the API, subscribing to EMQX via `aiomqtt`
- Payload validation with Pydantic — malformed messages logged and dropped, never fatal
- **EMQX authentication against the device table**, ACLs restricting each device to its own topic subtree
- HTTP REST ingest fallback endpoint
- Redis Stream → batched writer → TimescaleDB
- **Hypertable, compression, continuous aggregates, retention policies**
- Telemetry query API: `GET /devices/{id}/latest`, `GET /devices/{id}/data?from=&to=&resolution=`

### Manual installation

```bash
uv add aiomqtt redis
```

Configure EMQX authentication. Access the dashboard through a tunnel:

```bash
ssh -L 18083:127.0.0.1:18083 user@yourdomain.com
```

At `http://localhost:18083`, configure the PostgreSQL authentication and ACL sources pointing at the
`devices` table. **Change the default `admin/public` credentials immediately.**

Provision TLS for MQTT on 8883 by mounting `/etc/letsencrypt/live/yourdomain.com/` into the EMQX
container read-only. **Add a certbot renewal hook that reloads EMQX**, or the certificate expires
silently in 90 days and every device drops off.

Enable TimescaleDB policies in a migration:

```sql
SELECT create_hypertable('telemetry', 'time');
ALTER TABLE telemetry SET (timescaledb.compress, timescaledb.compress_segmentby = 'device_id');
SELECT add_compression_policy('telemetry', INTERVAL '7 days');
SELECT add_retention_policy('telemetry', INTERVAL '90 days');
```

Add continuous aggregates for 1-minute and 1-hour rollups.

### Critical detail
Set up compression and retention **now, in this phase.** Adding them after months of accumulated raw
telemetry means a painful backfill against a database already under pressure. This is the single
biggest cost risk in the project.

Run the worker under its own supervisor (systemd unit or compose service with `restart: always`) —
it is a long-lived process and its failure mode is silent data loss.

### Deliverables
- Telemetry flowing MQTT → TimescaleDB with per-device auth and ACLs
- MQTT/TLS on 8883 with automated certificate reload
- Compression, aggregates, and retention active from day one

---

## Phase 3 — Rules engine, hot path & actuators

**Complexity: L** · **Depends on: 2**

**Milestone — this is the architecture's acceptance test:** a simulated sensor crosses a threshold and
the actuator command is observed on the broker **in under 2 seconds**, measured and recorded.

### Scope
- Rule schema and CRUD (CLAUDE.md §6)
- **The `Evaluator` protocol** — pure, synchronous, no I/O. This interface is the extension point for
  both dedicated-client custom logic (Phase 7) and ML detectors (future phase). Get it right here.
- **In-memory hot-path evaluation** in the worker, fed directly from ingestion before the DB write;
  active rules cached in process, invalidated on change
- **Flapping prevention:** `for_duration`, `hysteresis`, `cooldown`
- Command Service: publishes to `cmd` topics at QoS 1 with TTL and `command_id`
- **Retained desired-state** topic per actuator, for reconnect convergence
- Acknowledgement handling on `ack` topics; command audit log
- Notification (email) and webhook actions
- Latency instrumentation: record breach→publish for every firing

### Manual installation
No new server software. Optionally configure **EMQX's built-in Rule Engine** as a broker-level backstop
for the most safety-critical thresholds, so they still fire if the application is down.

### Critical detail
Unit-test the evaluators hard: threshold boundaries, duration held vs. not held, hysteresis re-arming,
cooldown suppression, and rapid oscillation around the threshold. **A flapping bug cycles a physical
relay and destroys hardware.** This is the highest-consequence logic in the codebase — and because
evaluators are pure and synchronous, exhaustive testing is cheap. There is no excuse for skipping it.

Measure the 2s budget with the system under realistic load, not idle. Record the number.

### Deliverables
- Working threshold/rule engine with actuator control
- Stable `Evaluator` interface that ML and custom plugins will implement
- Verified sub-2s breach→command latency, documented
- Evaluator test suite covering flapping prevention

---

## Phase 4 — Dashboard

**Complexity: L** · **Depends on: 1, 2, 3**

**Milestone:** a new user signs up, registers a device, flashes the sample firmware, and sees live
data — in under 10 minutes. This is the product's north star from the original planning docs.

### Scope
- Next.js + Tailwind app: auth flows, device list and detail
- **WebSocket endpoints** (FastAPI native) fed by Redis pub/sub for live updates
- Widgets: line charts, gauges, stat cards; configurable dashboard layouts
- Historical views querying continuous aggregates, never raw telemetry
- **Rule editor UI** — threshold builder with plain-language preview
- Manual actuator control (buttons/toggles) with live state feedback
- **Onboarding flow:** copy-paste ESP32 firmware with credentials pre-filled

### Manual installation

```bash
cd src/frontend && pnpm add uplot swr
```

Set up OpenAPI type generation as a package script:

```bash
npx openapi-typescript http://localhost:8000/openapi.json -o src/types/api.ts
```

**Use uPlot rather than Recharts** for the live charts — at thousands of points it is dramatically
faster, and streaming telemetry gets there quickly.

### Critical detail
The dashboard must query **rollups, not raw rows.** A chart that pulls a month of raw telemetry will
be slow at 10 devices and unusable at 500. Wire resolution selection to the continuous aggregates
from Phase 2.

Re-run the type codegen after every backend schema change and commit the result. Drift between
`api.ts` and the actual API is the main tax of the two-language stack — make regeneration a reflex.

Time the onboarding path yourself with a stopwatch on a fresh account. Per the original docs, ease of
onboarding is the intended competitive advantage — treat the 10-minute figure as a requirement.

### Deliverables
- Real-time dashboard with charts, gauges, and actuator control
- Rule editor
- Generated API client wired into the frontend build
- Onboarding flow verified under 10 minutes

---

## Phase 5 — Billing & freemium

**Complexity: M** · **Depends on: 1, 4**

**Milestone:** a user upgrades through Stripe Checkout and their device and retention limits change
immediately.

### Scope

Plan tiers carried from the original planning docs:

| Plan | Price | Devices | History | Notes |
|---|---|---|---|---|
| Free | $0 | 2 | 7 days | 1 dashboard, 1 msg / 5s |
| Premium | $5 | 20 | 90 days | unlimited dashboards, CSV export |
| Control | $10 | 20 | 90 days | **actuators, commands, rules** |

- Stripe Checkout + Customer Portal, webhook handling for subscription lifecycle
- **Quota enforcement:** device count, message rate, dashboard count, retention by plan
- Rate limiting at ingestion (Redis counters) and on the REST API
- Usage display in the UI, upgrade prompts at limits

### Manual installation

```bash
uv add stripe
```

Create a Stripe account, define products and prices in the dashboard, obtain API keys. For local
webhook testing install the Stripe CLI:

```bash
stripe listen --forward-to localhost:8000/billing/webhook
```

### Critical detail
**Enforce retention by plan in the database, not just the UI.** A downgraded user must actually stop
consuming 90 days of storage, or the freemium tier becomes an unbounded cost. Wire plan changes to
per-tenant retention.

Handle Stripe webhooks idempotently — they retry, and duplicate processing corrupts subscription state.

*Note: neither Python nor Node has a Laravel Cashier equivalent, so this phase is hand-rolled. That
cost was identical across every stack considered and did not affect the decision.*

### Deliverables
- Working subscription billing with three tiers
- Quota and rate-limit enforcement at the data layer
- Plan-driven retention actually reclaiming storage

---

## Phase 6 — Production hardening

**Complexity: M** · **Depends on: 0–5**

**Milestone:** you have restored the database from a backup onto a clean host and the platform came
back up. Until you have done this, you do not have backups.

### Scope
- Automated daily `pg_dump` to off-VPS object storage, with rotation
- **A restore runbook you have personally executed end to end**, with measured restore time
- Monitoring: container health, disk usage, memory, message rates, ingestion lag
- Alerting to yourself on disk >80%, container restarts, ingestion stalls
- Security review: TLS everywhere, credentials hashed, EMQX defaults changed, dependency audit
  (`uv pip audit`), rate limits verified
- EMQX backstop rules for safety-critical thresholds
- Log rotation (containers will fill the disk otherwise)

### Manual installation

```bash
sudo apt-get install -y postgresql-client restic
```

Schedule the backup with a systemd timer or cron entry, writing to off-VPS storage. **Backups on the
same VPS are not backups** — the failure mode you are protecting against takes the whole host.

Optional monitoring, if RAM allows: Prometheus and Grafana containers bound to localhost, reachable
via SSH tunnel. On 8 GB alongside everything else this is tight — a hosted uptime monitor plus
disk-usage alerts is an acceptable lighter alternative.

### Critical detail
Given the accepted no-HA trade-off, **restore time is your actual availability guarantee.** Measure
it, write it down, and re-test the runbook after any infrastructure change. An untested backup is a
guess.

### Deliverables
- Off-site automated backups
- Restore runbook with a measured, verified restore time
- Monitoring and alerting on the failure modes that matter
- Completed security review checklist

---

## Phase 7 — `iot-dedicated` repository

**Complexity: L** · **Depends on: 3, 4, 6**

**Milestone:** a single-tenant deployment running for one client on its own stack, with its own
branding and domain, fed by the same ESP32 firmware as the SaaS.

### Scope
- **Bootstrap:** copy the hardened `iot-saas` backend and frontend into a new independent repository
- **Strip:** the tenants module, RLS policies, billing module, freemium quotas. Single-tenant means a
  fixed tenant constant in the topic scheme and no isolation layer
- **White-label:** logo, colors, product name, custom domain — all config-driven via `pydantic-settings`
- **Custom rule plugins:** a loader that discovers client-specific classes implementing the
  `Evaluator` protocol from Phase 3
- **Custom integrations:** webhook dispatcher and an adapter interface for external APIs
- **Per-client deployment:** its own `docker-compose.yml`, database, and domain
- Repo-scoped `CLAUDE.md` including the shared contract verbatim

### Manual installation
Same stack as Phase 0, provisioned per client — either a separate VPS or the client's own
infrastructure. **Do not co-locate a dedicated client with the SaaS on the shared VPS**, except for a
short-lived pilot: it couples release cycles and undermines the isolation the client is paying for.

### Critical detail
This is where the two-repo cost becomes real. From this moment, **a core bug means two fixes.** Adopt
the `[core]` commit tag from CLAUDE.md §2 immediately and check both repos on every core-path change.

Verify the shared contract holds: point an unmodified SaaS device at the dedicated deployment and
confirm it works. If it doesn't, the contract has already drifted.

### Deliverables
- Independent `iot-dedicated` repo, single-tenant, deployed for one client
- White-label config, evaluator plugin loader, integration adapters
- Per-client deployment runbook
- Verified firmware compatibility across both products

---

## Phase 8 — OPC UA edge connector

**Complexity: M/L** · **Depends on: 7** · **`iot-dedicated` only**

**Milestone:** a value change on a client PLC appears in TimescaleDB, and a cloud rule breach writes
back to an OPC UA node — confirmed on the server.

### Scope
Standalone Python service using **`asyncua`** (opcua-asyncio), running **on client-site hardware**
(industrial PC or Raspberry Pi — $0 against the VPS budget). Same language as the backend, so payload
and mapping code follows the same conventions.

- OPC UA client with security: X.509 certificates, `Basic256Sha256`, username/password as required
- Subscriptions with monitored items — sampling interval and deadband **per node**
- **Node→metric mapping config:**
  ```json
  { "nodeId": "ns=2;s=Line1.Temperature", "metric": "temperature",
    "device": "plc01", "samplingInterval": 1000, "deadband": 0.5 }
  ```
- Publishes to EMQX over MQTT/TLS using the **existing shared contract** — no platform core changes
- Subscribes to command topics and performs **OPC UA node writes** for actuation
- Store-and-forward buffer for WAN outages
- Connector health published as its own telemetry stream

### Manual installation

**1.** Install Python 3.12 and `uv` on the edge host, then:

```bash
uv add asyncua aiomqtt
```

**2.** Generate the connector's OPC UA application certificate and **exchange trust with the client's
server** — the server must trust the connector's certificate and vice versa. This is usually done in
the server's certificate management UI and is the most common source of setup failure.

**3.** Install the connector as a systemd service with `Restart=always`.

**4.** Network: the connector reaches the OPC server on the local network (typically `opc.tcp://` port
4840) and makes only an **outbound** connection to EMQX on 8883. **The OPC server is never exposed to
the internet.** No inbound firewall rules on the client side.

**5.** Test against a simulated server first (Prosys OPC UA Simulation Server, or the `asyncua`
example server) before touching client equipment.

### Explicit limitations
- **Rule evaluation stays in the cloud.** The actuation path is PLC → connector → VPS → rule →
  connector → PLC write. This fits the 2s budget over a decent link, but is **not suitable for safety
  interlocks.** Edge-side evaluation — running the same `Evaluator` classes locally, which is
  straightforward now that the connector is Python — is the documented upgrade path.
- **OPC Classic / DA is out of scope.** No DCOM bridge is built. Clients on legacy DA must front it
  with a commercial UA wrapper (Kepware, Matrikon).
- **Check before building:** modern PLCs supporting OPC UA PubSub over MQTT with JSON encoding can
  publish straight to EMQX, needing only a payload decoder in ingestion — no connector at all. Confirm
  the client's hardware capability first; it may save the entire phase.

### Deliverables
- OPC UA connector with read subscriptions and write-back actuation
- Mapping configuration format and setup documentation
- Certificate exchange and deployment runbook
- Verified against a simulated server, then against client equipment

---

## Phase 9 (future, 12–18 months) — ML / anomaly detection

**Complexity: L** · **Depends on: 3, 6** · **Not scoped in detail — sketch only**

This phase is the reason the backend is Python. It is listed so the earlier phases are built to
accommodate it, not because it should be started soon.

### Shape
- Anomaly detectors implement the **same `Evaluator` protocol** from Phase 3 and run **in the same
  worker process, on the same hot path** — so a detection can trigger an actuator directly, with no
  cross-service hop inside the 2s budget.
- Offline training reads history from TimescaleDB continuous aggregates; models are **loaded at worker
  startup**, never per message (CLAUDE.md §10, constraint 2).
- Likely progression: rolling-window statistics and z-score rules (numpy) → seasonal decomposition →
  learned per-device baselines. Each step is a new `Evaluator`, not a new service.
- CPU-bound training runs as a scheduled job in a separate process; only inference sits on the hot path.

### What earlier phases must get right for this to work
- The `Evaluator` protocol stays pure and synchronous (Phase 3)
- Continuous aggregates give clean training data (Phase 2)
- Rule storage accommodates a `type` discriminator and per-rule state (Phase 3)

---

## Sequencing notes

**Phases 0–3 are the critical path.** They prove the architecture's hardest requirement — sub-2s
actuation. If the 2s budget cannot be met at the end of Phase 3, stop and revisit the design before
building the dashboard on top of it.

**Phase 4 can start once Phase 3's API contracts are stable**, slightly overlapping if you prefer to
alternate backend and frontend work.

**Phases 5 and 6 can be reordered** if you want a hardened free beta before charging anyone. Hardening
first is the safer sequence; billing first gets revenue sooner.

**Phase 7 is a commitment point.** Before starting it, be confident the core is stable — every fix
after the copy costs double. If a paying dedicated client appears earlier, a short-lived pilot
alongside the SaaS is acceptable, but migrate it to its own stack promptly.
