# CLAUDE.md — iot-saas

Project guidance for Claude Code. Read this before making changes.

---

## 1. What this is

A multi-tenant IoT platform: it ingests sensor telemetry over MQTT, evaluates threshold and rule
logic in real time, drives actuators, and serves live dashboards.

### Requirements that shape every decision

| Constraint | Value |
|---|---|
| Actuator latency | **< 2s** from threshold breach to actuator command |
| Scale (design point) | **500–1,000 devices** |
| Deployment | Single Linux VPS, Docker Compose |
| Roadmap | ML/anomaly detection is a planned extension |

The platform runs on modest single-host infrastructure. When in doubt, choose the option one person
can operate and debug at 3am.

---

## 2. Architecture

### Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js + React + Tailwind CSS (+ uPlot for high-frequency charts) |
| Backend | Python 3.12 + FastAPI (async), Pydantic v2 |
| Hot path / worker | asyncio + `aiomqtt`, separate process |
| ORM / migrations | SQLAlchemy 2.0 (async) + Alembic |
| Relational + time-series | PostgreSQL + TimescaleDB |
| MQTT broker | EMQX |
| Cache / stream / pub-sub | Redis (`redis.asyncio`) |
| Edge / proxy | NGINX + Let's Encrypt |
| Runtime | Docker + Docker Compose |

**Two languages, one seam: Python backend, TypeScript frontend.** The frontend/backend boundary is
mediated by codegen — FastAPI emits an OpenAPI schema and `openapi-typescript` generates the
frontend's API client from it. **Regenerate the client whenever backend schemas change**; never
hand-write API types on the frontend.

### The split telemetry path

This is the single most important thing to understand. **Telemetry forks into two paths at ingestion.**

```
                              ┌──► HOT PATH ──────────────────────────────────┐
                              │    Rule Evaluator (in-memory, no DB read)     │
                              │      breach? → Command Service → EMQX → Actuator
ESP32 ──MQTT/TLS──► EMQX ──► Ingestion                                        │
                              │                                               │
                              └──► STORAGE PATH ──────────────────────────────┘
                                   Redis Stream → batched Writer → TimescaleDB

  FastAPI (REST + WebSocket)  ◄── Redis pub/sub
              ▲
              └── Next.js dashboard (live charts over WebSocket)
```

**Hot path** — rules are evaluated **in memory, the moment a message arrives, before any database
write.** Active rules are cached in the worker process and invalidated on change. Typical
breach→command latency is well under 500ms on a single host, giving generous headroom against the
2s requirement.

**Storage path** — telemetry is pushed to a Redis Stream and drained by a writer that batches inserts
into TimescaleDB hypertables. Batching is good for throughput and bad for latency, which is precisely
why it is **not** on the actuation path.

> **Never put a database round-trip, a queue hop, or a batch flush between message arrival and rule
> evaluation.** That is the constraint that makes the 2s budget hold. If a change requires data the
> evaluator doesn't have in memory, cache it — don't fetch it inline.

**Process layout:** the FastAPI API server and the ingestion/rules worker are **two separate
processes from the same codebase**. They share models, schemas, and evaluators by import. The API
never subscribes to MQTT; the worker never serves HTTP.

### Known boundary: the 2s SLA assumes a connected device

If a device is offline, no command can reach it, and no architecture fixes that. The retained
desired-state topic is how a device catches up: on reconnect it receives the latest desired state
immediately. **Document this to users as expected behaviour, not as a defect.** Commands carry a TTL
so a device reconnecting after a long outage does not act on a stale instruction.

---

## 3. Design decisions and rationale

Each entry: the decision, why, and what was rejected.

**Python + FastAPI for the backend, not Node/NestJS or Laravel.**
The deciding factor is the ML roadmap. Anomaly detection is only valuable if it can *trigger
actuators* — and if the ML lives in a different runtime, detections must cross a process boundary
back into the rule system, adding latency and a failure mode to a path budgeted at 2 seconds. With a
Python backend, a statistical or learned rule is **just another evaluator implementing the same
interface, in-process, on the hot path** (§5). It also gives a smooth gradient: fixed thresholds →
rolling-window/z-score rules (numpy) → learned detection, with no cliff.

*Rejected — Node/NestJS:* native shared types and an opinionated module structure are genuine
advantages, but ML would arrive as a separate Python service regardless, putting the seam in the
worst possible place. *Rejected — Laravel:* the SPA-grade dashboard requirement negates its
full-stack (Blade/Livewire) advantage, and PHP's request-response model is a structural mismatch for
a long-lived MQTT subscriber holding in-memory rule state. *Rejected — Django:* the free admin panel
and mature multi-tenancy packages are real, but async is bolted on, and both the MQTT hot path and
WebSockets fight the framework. `sqladmin` covers basic admin needs on FastAPI.

*Accepted costs:* no native type sharing (mitigated by OpenAPI codegen, not eliminated), and FastAPI
is unopinionated — the module discipline in §6 must be enforced by you, not the framework.

**Split hot/storage path for rule evaluation.**
The only reliable way to hold <2s. Rejected: evaluating rules in a post-storage worker — simpler, but
batching and DB latency put the 2s budget at risk under load, exactly when it matters most.

**Redis Streams as the buffer, not Kafka.**
At 500–1,000 devices, Kafka's throughput is irrelevant and its memory footprint is not — it would
consume a large share of a single host. Redis is already needed for cache and WebSocket pub/sub, so
the stream is free. Rejected: Kafka, RabbitMQ. *Revisit at ~10k devices.*

**Modular monolith, not microservices.**
One API process plus one worker process, from one codebase. Rejected: service-per-domain —
operationally hostile for a small team, and network hops would eat the latency budget.

**Single host, backups only. No HA.**
Automated daily backups plus a **restore runbook that has actually been tested.** Accepted RTO is
minutes, not seconds. Rejected: DB replica / multi-node — correct engineering, but not justified at
this deployment scale.

**MQTT over TLS as primary protocol.**
Purpose-built for constrained devices: small footprint, persistent sessions, QoS levels, last-will
messages, and bidirectional topics that make actuator commands natural. HTTP REST ingest exists as a
fallback. Rejected: HTTP polling as primary — cannot meet <2s command delivery without wasteful poll
rates.

**Retained desired-state (device shadow) for actuators.**
A device that reconnects must converge to the intended state without the platform tracking who missed
what. Rejected: per-device command queue — more state to manage, more ways to desync.

**Pluggable rule evaluator.**
An interface boundary means both custom rule logic and a future anomaly detector are modules, not
forks of the engine. Rejected: Node-RED as the core engine — excellent for prototyping, but hard to
multi-tenant and version-control.

**Row-Level Security for tenant isolation.**
`tenant_id` on every table plus Postgres RLS means a forgotten `WHERE` clause is not a data breach.
Defense in depth under the application layer. Rejected: schema-per-tenant — better isolation, but
migration pain grows linearly with tenant count.

**Edge-connector pattern for non-MQTT protocols.**
Non-MQTT sources (OPC UA, Modbus, vendor cloud APIs) are **never** added to the platform core.
Instead a small connector runs on the client's network, translates to the device contract below, and
speaks MQTT/TLS to EMQX. To the platform it is indistinguishable from a device. This keeps
protocol-specific dependencies out of the core and keeps industrial servers off the public internet.

---

## 4. The device contract

This interface is **shared with a separate single-tenant deployment variant** of this platform, so
the same device firmware works against either. It is kept in sync manually. **Treat it as stable —
changes are breaking and must be applied in both places deliberately, with firmware compatibility
considered.**

**MQTT topic scheme**
```
{tenant}/{device}/{metric}                 telemetry  (device → platform)
{tenant}/{device}/cmd/{actuator}           command    (platform → device, QoS 1)
{tenant}/{device}/state/{actuator}         desired state (retained)
{tenant}/{device}/ack/{actuator}           acknowledgement (device → platform)
{tenant}/{device}/config                   telemetry profile (retained, platform → device)
{tenant}/{device}/status                   health snapshot (retained, device → platform; Last-Will target)
```
`status` and `config` are reserved metric-key segments — a tenant-authored metric can never collide
with them (enforced at catalog write time).

**Telemetry payload**
```json
{ "value": 27.4, "timestamp": 1770001111 }
```
`timestamp` is Unix seconds and optional — the ingestion service stamps server time if absent.

**Command payload**
```json
{ "value": true, "issued_at": 1770001111, "ttl": 30, "command_id": "uuid" }
```

**Config payload** (retained; the device subscribes on connect, same as the desired-state topic)
```json
{ "metrics": [{ "key": "temperature", "publish": "periodic", "interval_seconds": 30 }], "issued_at": 1770001111 }
```
`publish` is `"periodic"` (default) / `"on_change"` / `"streaming"` — the device enforces its own
publish cadence locally; the platform only defines and distributes the profile.

**Status payload** (retained; also the device's Last-Will payload with `online: false` on ungraceful
disconnect)
```json
{ "online": true, "rssi": -63, "battery_pct": 87, "uptime_s": 1234, "fw_version": "1.2.0", "timestamp": 1770001111 }
```
The platform stamps its own receive time for staleness math and never trusts this payload's own
`timestamp` — a Last-Will fires at an unpredictable moment its payload can't reflect.

**Device auth:** per-device tokens / API keys, **stored hashed** (argon2id), never in plaintext.
MQTT credentials map 1:1 to a device; EMQX ACLs restrict each device to its own topic subtree.

Commits touching ingestion, rules, commands, or the telemetry schema are tagged `[core]` so they can
be cross-checked against the other deployment variant.

---

## 5. Data model and rule schema

### Core tables

`telemetry` is a **TimescaleDB hypertable** partitioned on `time`:

| column | notes |
|---|---|
| `time` | timestamptz, partition key |
| `tenant_id` | uuid |
| `device_id` | uuid |
| `metric` | text |
| `value` | double precision |

Relational tables: `tenants`, `users`, `devices`, `dashboards`, `rules`, `commands`, `api_keys`,
`subscriptions`. Every table carries `tenant_id` with an RLS policy.

**Storage discipline is the #1 operational risk.** Compression, continuous aggregates, and retention
policies are not optional tuning:
- compress chunks older than ~7 days
- continuous aggregates for 1-minute and 1-hour rollups; dashboards query rollups, never raw
- retention enforced per plan (7 days on the free tier, 90 days on paid), in the database rather than
  only in the UI

### Rule schema

```jsonc
{
  "id": "uuid",
  "device_id": "uuid",
  "metric": "temperature",
  "type": "threshold",          // "threshold" | "window" | "anomaly" (future)
  "operator": ">",              // > < >= <= == !=
  "threshold": 30.0,
  "for_duration": 10,           // seconds the condition must hold before firing
  "hysteresis": 2.0,            // must fall to 28.0 before the rule can re-arm
  "action": {
    "type": "actuator_command", // | "notification" | "webhook"
    "actuator": "fan1",
    "value": true
  },
  "cooldown": 60,               // min seconds between firings
  "enabled": true
}
```

**`for_duration`, `hysteresis`, and `cooldown` exist to stop actuators flapping.** A naive threshold
on noisy sensor data will cycle a relay continuously and destroy hardware. Do not add a rule path
that bypasses them.

### The evaluator interface

Every rule type implements the same protocol. This is the extension point for custom logic and
future ML:

```python
class Evaluator(Protocol):
    def evaluate(self, rule: Rule, reading: Reading, state: RuleState) -> Action | None: ...
```

Evaluators are **pure and synchronous** — no I/O, no awaits. Anything they need must already be in
`state`. This is what keeps the hot path fast and testable.

---

## 6. Repository layout

```
iot-saas/
├─ backend/
│  ├─ pyproject.toml         # uv-managed
│  ├─ alembic/               # migrations
│  ├─ tests/
│  └─ src/app/
│     ├─ main.py             # FastAPI app factory
│     ├─ worker.py           # ingestion + rules hot-path process entrypoint
│     ├─ config.py           # pydantic-settings
│     ├─ db.py               # async engine, session, RLS context
│     ├─ auth/               # JWT, API keys, device tokens, roles
│     ├─ tenants/            # tenant CRUD, RLS helpers
│     ├─ devices/            # registration, credentials, status
│     ├─ ingestion/          # MQTT subscriber, normalization, fork point
│     ├─ rules/              # evaluators (hot path), rule CRUD
│     ├─ commands/           # actuator dispatch, desired state, acks
│     ├─ telemetry/          # query API, aggregates
│     ├─ dashboards/         # layout persistence
│     ├─ billing/            # plan quotas
│     ├─ realtime/           # WebSocket endpoints, Redis pub/sub
│     └─ ml/                 # FUTURE — detectors implementing Evaluator
├─ frontend/                 # Next.js + Tailwind
│  └─ src/types/api.ts       # GENERATED from OpenAPI — never edit by hand
├─ infra/                    # docker-compose.yml, nginx/, emqx/, backups/
└─ docs/                     # firmware quickstart, API reference
```

**Module discipline.** FastAPI won't enforce structure, so this is the rule: every module under
`src/app/` follows the same internal shape —

```
<module>/
├─ router.py      # FastAPI routes — validation + delegation only, no business logic
├─ service.py     # business logic
├─ models.py      # SQLAlchemy models
├─ schemas.py     # Pydantic request/response models
└─ deps.py        # dependency-injection providers
```

Modules communicate through `service.py` functions, never by importing another module's `models.py`
directly. If two modules need the same model, that's a signal the boundary is wrong.

---

## 7. Coding conventions

**Python 3.12**, fully type-annotated. `mypy --strict` on `src/app/`. No bare `Any`; use `object` or
a `Protocol` and narrow. Async by default — every I/O path is `async def`.

**Pydantic v2** for all boundary validation: HTTP bodies, MQTT payloads, rule definitions, config
(`pydantic-settings`). **MQTT payloads are untrusted input** — a malformed publish must never crash
the ingestion worker.

**Tooling:** `uv` for dependencies and virtualenvs, `ruff` for both linting and formatting (replaces
black/flake8/isort), `mypy` for type checking, `pytest` + `pytest-asyncio` for tests. All configured
in `pyproject.toml`; no separate config files.

**FastAPI** — routers stay thin. Dependency injection via `Depends` for the DB session, current user,
and tenant context. The tenant context dependency is what sets the RLS session variable; **never
bypass it with a raw engine connection.**

**Database** — SQLAlchemy 2.0 async style (`select()`, not legacy `Query`). All schema changes via
Alembic migrations, never manual SQL against production. Every new table gets `tenant_id` **and** an
RLS policy in the same migration.

**Errors** — no bare `except:`. Ingestion and rule evaluation log with `device_id` and `tenant_id`
context. A single bad message is dropped and logged; it never stops the stream.

**Secrets** — environment variables only, loaded through `pydantic-settings`, never committed.
`.env.example` documents every variable. Device tokens and API keys hashed with argon2id.

**Naming** — `snake_case` in Python and the database, `camelCase` in TypeScript, `kebab-case` for
files on the frontend and for MQTT topic segments.

**Frontend types are generated.** Run the OpenAPI codegen after any schema change; treat
`frontend/src/types/api.ts` as a build artifact. A hand-edited API type is a bug waiting to happen —
this codegen step is what replaces the type safety a single-language stack would have given you.

**Testing** — `pytest` unit tests for the rule evaluators (the highest-risk logic: thresholds,
hysteresis, duration, cooldown) and for payload normalization. Integration test for the ingestion →
rule → command path. Evaluators are pure and synchronous specifically so they are trivial to test
exhaustively — take advantage of that. Also keep an explicit test proving one tenant cannot read
another's rows, run against real RLS policies rather than mocks.

---

## 8. Running and testing locally

Prerequisites: Docker Desktop, Python 3.12, `uv`, Node 20 LTS (frontend only), pnpm.

Bring up infrastructure (Postgres+TimescaleDB, EMQX, Redis):

```bash
docker compose -f infra/docker-compose.yml up -d
```

**One-time database bootstrap** (Phase 1+): the backend connects with two different Postgres
roles. `iot` (the compose superuser) runs migrations only; the running API/worker connect as
`iot_app`, a non-superuser role, because **superusers bypass Row-Level Security silently** — if
the app connected as `iot`, every RLS policy would be a no-op. Create the role and a `iot_test`
database for the test suite once per environment:

```bash
docker compose -f infra/docker-compose.yml exec timescaledb psql -U iot -d iot -c \
  "CREATE ROLE iot_app LOGIN PASSWORD 'iot_app_dev_password' NOSUPERUSER NOBYPASSRLS;"
docker compose -f infra/docker-compose.yml exec timescaledb psql -U iot -d iot -c \
  "GRANT CONNECT ON DATABASE iot TO iot_app;"
docker compose -f infra/docker-compose.yml exec timescaledb psql -U iot -d iot -c \
  "GRANT USAGE ON SCHEMA public TO iot_app;"
docker compose -f infra/docker-compose.yml exec timescaledb psql -U iot -c \
  "CREATE DATABASE iot_test OWNER iot;"
docker compose -f infra/docker-compose.yml exec timescaledb psql -U iot -d iot_test -c \
  "CREATE EXTENSION IF NOT EXISTS timescaledb;"
docker compose -f infra/docker-compose.yml exec timescaledb psql -U iot -d iot_test -c \
  "GRANT CONNECT ON DATABASE iot_test TO iot_app;"
```

Per-table `GRANT`s to `iot_app` are issued inside each table's own Alembic migration, next to its
`CREATE POLICY` statement — not here.

Backend:

```bash
cd backend && uv sync && cp .env.example .env
```

```bash
uv run alembic upgrade head
```

```bash
uv run uvicorn app.main:app --reload --port 8000
```

The hot-path worker, in a second terminal — **the API alone will not process telemetry**:

```bash
cd backend && uv run python -m app.worker
```

Frontend, in a third:

```bash
cd frontend && pnpm install && pnpm dev
```

Regenerate the API client whenever backend schemas change:

```bash
npx openapi-typescript http://localhost:8000/openapi.json -o src/types/api.ts
```

Dashboard on `http://localhost:3000`, API docs on `http://localhost:8000/docs`, EMQX dashboard on
`http://localhost:18083`.

**Simulate a device** — register one in the UI, copy its token, then publish:

```bash
mosquitto_pub -h localhost -p 1883 -u <device_id> -P <token> -t "demo/sensor01/temperature" -m '{"value":31.5}'
```

The value should appear on the live chart within a second. If a rule is armed on that metric, the
corresponding command publishes to `demo/sensor01/cmd/<actuator>` — subscribe with `mosquitto_sub`
to watch it.

**Checks**

```bash
cd backend && uv run pytest && uv run ruff check . && uv run mypy src/app
```

---

## 9. Constraints future changes must respect

These are not style preferences. Breaking one of these breaks a requirement.

1. **No DB round-trip, queue hop, or batch flush between message arrival and rule evaluation.** The
   <2s requirement depends on the hot path staying in memory.
2. **Evaluators stay pure and synchronous.** No I/O, no awaits inside `evaluate()`. This holds for
   future ML detectors too — load models at startup, not per message.
3. **Compression, continuous aggregates, and retention policies stay enabled.** Disabling them to
   simplify a query will grow storage without bound.
4. **Every new table gets `tenant_id` and an RLS policy**, in the same migration that creates it.
5. **Never bypass the tenant-context dependency** with a raw engine connection — that is what makes
   RLS effective.
6. **Device-contract changes (§4) must be applied to both deployment variants**, with firmware
   compatibility considered.
7. **Flapping prevention (`for_duration`, `hysteresis`, `cooldown`) must not be bypassable.** Real
   relays and real hardware are on the other end.
8. **Frontend API types are generated, never hand-written.**
9. **Stay on one host** until a deliberate infrastructure-split plan exists. The current design is
   validated to ~1,000 devices.
10. **No protocol-specific dependencies in the platform core.** New protocols use the edge-connector
    pattern (§3).
11. **MQTT payloads are untrusted.** Validate at the boundary; never let one malformed message halt
    ingestion.
12. **Device tokens and API keys are stored hashed.** No plaintext credentials, ever.
13. **The restore runbook must stay tested.** A backup that has never been restored is not a backup.
