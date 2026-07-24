# iot-saas

**Real-time IoT telemetry, rules, and actuator control — connect an ESP32 in under 10 minutes.**

A multi-tenant IoT platform that ingests sensor telemetry over MQTT, evaluates threshold and rule
logic in real time, drives actuators, and serves live dashboards. Built for ESP32 makers, small
agriculture, and solar DIY.

> **Status: pre-development.** Phase 0 has not started. This README describes the intended shape of
> the repository; sections marked _(planned)_ are not yet implemented. See `PLAN.md` in the workspace
> root for the staged build order.

---

## Why this exists

Most IoT platforms are either too simple to control anything real, or enterprise products with
enterprise pricing and enterprise onboarding. This one aims at the gap: a maker should be able to
create an account, paste a sketch into the Arduino IDE, and watch live data within ten minutes — then
arm a rule that switches a relay when a threshold is crossed.

**The headline guarantee: under 2 seconds from threshold breach to actuator command.**

---

## Features

| | |
|---|---|
| **Telemetry ingest** | MQTT over TLS (primary) with an HTTP REST fallback |
| **Rules engine** | Threshold rules with duration, hysteresis, and cooldown to prevent relay flapping |
| **Actuator control** | QoS 1 commands with TTL, plus retained desired-state so devices converge after reconnecting |
| **Live dashboards** | WebSocket-driven charts, gauges, and stat cards |
| **History** | TimescaleDB with continuous aggregates and per-plan retention |
| **Multi-tenant** | `tenant_id` everywhere, enforced by PostgreSQL Row-Level Security |
| **Freemium billing** | Stripe-backed Free / Premium / Control tiers |

---

## Architecture in one diagram

Telemetry **forks into two paths** at ingestion. This is the single most important thing to know
about this codebase:

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
              └── Next.js dashboard
```

Rules are evaluated **in memory, before any database write.** The storage path batches for throughput;
the hot path stays in memory for latency. Never put a database round-trip between message arrival and
rule evaluation — that is what makes the 2s budget hold.

**Two processes, one codebase:** the FastAPI API server and the ingestion/rules worker run separately
and share models, schemas, and evaluators by import. The API never subscribes to MQTT; the worker
never serves HTTP.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js + React + Tailwind CSS, uPlot for high-frequency charts |
| Backend | Python 3.12 + FastAPI (async), Pydantic v2 |
| Worker | asyncio + `aiomqtt` |
| Database | PostgreSQL + TimescaleDB |
| Broker | EMQX |
| Cache / streams | Redis |
| Infrastructure | Docker Compose, NGINX, Let's Encrypt, single Linux VPS |

Backend and frontend are separate languages by design. The seam is mediated by codegen: FastAPI emits
an OpenAPI schema and the frontend's API client is generated from it. **`frontend/src/types/api.ts` is
a build artifact — never edit it by hand.**

---

## Quick start (development)

**Prerequisites:** Docker Desktop, Python 3.12, [`uv`](https://docs.astral.sh/uv/), Node 20 LTS, pnpm,
and `mosquitto-clients` for testing.

Start the infrastructure — PostgreSQL + TimescaleDB, EMQX, and Redis:

```bash
docker compose -f infra/docker-compose.yml up -d
```

Set up and migrate the backend:

```bash
cd backend && uv sync && cp .env.example .env
```

```bash
uv run alembic upgrade head
```

Run the API server:

```bash
uv run uvicorn app.main:app --reload --port 8000
```

Run the hot-path worker in a second terminal — **the API alone will not process telemetry**:

```bash
cd backend && uv run python -m app.worker
```

Run the frontend in a third:

```bash
cd frontend && pnpm install && pnpm dev
```

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API docs (Swagger) | http://localhost:8000/docs |
| EMQX dashboard | http://localhost:18083 |

Regenerate the frontend API client after any backend schema change:

```bash
npx openapi-typescript http://localhost:8000/openapi.json -o src/types/api.ts
```

---

## Connect a device

### 1. Register it

Create a device in the dashboard and copy its **device ID** and **token**. The token is shown once and
stored hashed — it cannot be retrieved later.

### 2. Publish telemetry

Simulate a device from the command line:

```bash
mosquitto_pub -h localhost -p 1883 -u <device_id> -P <token> -t "demo/sensor01/temperature" -m '{"value":31.5}'
```

The value should appear on the live chart within a second.

### 3. Or flash an ESP32

```cpp
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>

const char* WIFI_SSID  = "your-network";
const char* WIFI_PASS  = "your-password";

const char* MQTT_HOST  = "mqtt.yourdomain.com";
const int   MQTT_PORT  = 8883;
const char* DEVICE_ID  = "paste-from-dashboard";
const char* DEVICE_TOK = "paste-from-dashboard";
const char* TOPIC      = "your-tenant/sensor01/temperature";

WiFiClientSecure net;
PubSubClient mqtt(net);

void setup() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);

  net.setInsecure();              // for testing only — pin the CA in production
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  while (!mqtt.connect(DEVICE_ID, DEVICE_ID, DEVICE_TOK)) delay(2000);
}

void loop() {
  float celsius = readYourSensor();

  char payload[64];
  snprintf(payload, sizeof(payload), "{\"value\":%.2f}", celsius);
  mqtt.publish(TOPIC, payload);

  mqtt.loop();
  delay(10000);
}
```

The dashboard generates this sketch with your credentials already filled in.

---

## The device contract

This interface is shared with [`iot-dedicated`](../iot-dedicated), so the same firmware works against
either deployment. **Treat it as stable** — changes are breaking and must land in both repos.

### Topics

| Topic | Direction | Notes |
|---|---|---|
| `{tenant}/{device}/{metric}` | device → platform | telemetry |
| `{tenant}/{device}/cmd/{actuator}` | platform → device | command, QoS 1 |
| `{tenant}/{device}/state/{actuator}` | platform → device | desired state, retained |
| `{tenant}/{device}/ack/{actuator}` | device → platform | acknowledgement |

### Payloads

Telemetry — `timestamp` is Unix seconds and optional; the server stamps arrival time if absent:

```json
{ "value": 27.4, "timestamp": 1770001111 }
```

Command:

```json
{ "value": true, "issued_at": 1770001111, "ttl": 30, "command_id": "uuid" }
```

**Devices should honour `ttl`.** A device reconnecting after a long outage must not act on a stale
instruction.

---

## Rules

A rule watches one metric on one device and fires an action when its condition holds.

```jsonc
{
  "device_id": "uuid",
  "metric": "temperature",
  "type": "threshold",
  "operator": ">",
  "threshold": 30.0,
  "for_duration": 10,     // condition must hold 10s before firing
  "hysteresis": 2.0,      // must fall to 28.0 before re-arming
  "cooldown": 60,         // min seconds between firings
  "action": { "type": "actuator_command", "actuator": "fan1", "value": true },
  "enabled": true
}
```

`for_duration`, `hysteresis`, and `cooldown` are **not optional tuning.** A naive threshold on noisy
sensor data will cycle a relay continuously and destroy hardware. Do not add a rule path that
bypasses them.

Every rule type implements the same interface, which is also the extension point for custom
client logic and future anomaly detection:

```python
class Evaluator(Protocol):
    def evaluate(self, rule: Rule, reading: Reading, state: RuleState) -> Action | None: ...
```

Evaluators are **pure and synchronous** — no I/O, no awaits. Whatever they need must already be in
`state`. That is what keeps the hot path fast and makes exhaustive testing cheap.

---

## Project layout

```
iot-saas/
├─ backend/
│  ├─ pyproject.toml         # uv-managed
│  ├─ alembic/               # migrations
│  ├─ tests/
│  └─ src/app/
│     ├─ main.py             # FastAPI app factory
│     ├─ worker.py           # ingestion + rules hot path
│     ├─ auth/  tenants/  devices/
│     ├─ ingestion/          # MQTT subscriber, normalization, fork point
│     ├─ rules/              # evaluators (hot path), rule CRUD
│     ├─ commands/           # actuator dispatch, desired state, acks
│     ├─ telemetry/  dashboards/  billing/  realtime/
│     └─ ml/                 # future — detectors implementing Evaluator
├─ frontend/                 # Next.js + Tailwind
├─ infra/                    # docker-compose, nginx, emqx, backups
└─ docs/                     # firmware quickstart, API reference
```

Every backend module follows the same internal shape — `router.py` (routes, no business logic),
`service.py` (business logic), `models.py` (SQLAlchemy), `schemas.py` (Pydantic), `deps.py` (DI
providers). Modules talk to each other through `service.py`, never by importing another module's
`models.py`.

---

## Testing

```bash
cd backend && uv run pytest
```

```bash
uv run ruff check . && uv run mypy src/app
```

Two test areas matter more than the rest:

- **Rule evaluators** — thresholds, duration, hysteresis, cooldown, and oscillation around the
  boundary. A bug here damages physical hardware.
- **Tenant isolation** — an explicit test proving tenant A cannot read tenant B's rows, run against
  real RLS policies rather than mocks.

---

## Plans

| Plan | Price | Devices | History | Includes |
|---|---|---|---|---|
| Free | $0 | 2 | 7 days | 1 dashboard, 1 msg / 5s |
| Premium | $5/mo | 20 | 90 days | Unlimited dashboards, CSV export |
| Control | $10/mo | 20 | 90 days | **Actuators, commands, rules** |

Retention is enforced in the database, not just the UI.

---

## Known limitations

- **The 2s guarantee assumes a connected device.** If a device is offline, no command can reach it.
  The retained desired-state topic is how it catches up on reconnect — this is expected behaviour,
  not a defect.
- **No high availability.** The platform runs on a single VPS with automated daily backups and a
  tested restore runbook. Recovery is measured in minutes, not seconds. This is a deliberate
  trade-off against a $100/month infrastructure budget.
- **Validated to ~1,000 devices.** Beyond that, the single-host design needs an infrastructure split.

---

## Documentation

- **`CLAUDE.md`** _(repo-scoped, added in Phase 0)_ — architecture, design decisions and their
  rationale, coding conventions, and constraints that changes must respect
- **`PLAN.md`** _(workspace root)_ — staged development plan with manual setup instructions per phase
- **`docs/`** — firmware quickstart and API reference

---

## Related

**[`iot-dedicated`](../iot-dedicated)** — the single-tenant, customizable variant of this platform,
sold per client with white-label branding, custom rule plugins, and custom integrations. It is a
**fully independent repository**, bootstrapped from this one and evolving separately. The device
contract above is the one thing kept in sync between them.

Commits touching ingestion, rules, commands, or the telemetry schema are tagged `[core]` so they can
be cross-checked against the other repo.

---

## License

Proprietary. All rights reserved.
