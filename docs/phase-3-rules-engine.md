# Phase 3 — Rules Engine, Hot Path & Actuators: deliverables & how to test them

Companion doc to `PLAN.md`'s "Phase 3 — Rules engine, hot path & actuators" section. This is
a map of what got built, where the code lives, and how to poke at it yourself.

**Milestone met — this is the architecture's acceptance test:** a simulated sensor crosses a
threshold and the actuator command is observed on the broker in under 2 seconds, measured and
recorded. Verified live against the running stack: **118.6ms** from telemetry publish to
`cmd` topic observed (roughly 17x under budget), plus the retained `state` topic and rule
disable → cache invalidation, all confirmed live, not just in tests.

---

## Local URLs (stack already running via Docker Compose)

| What | URL |
|---|---|
| **Interactive API docs (Swagger UI)** | **http://localhost:8000/docs** |
| EMQX dashboard | http://localhost:18083 (login `admin` / `EMQX_DASHBOARD_PASSWORD`) |
| Health check | http://localhost:8000/health |

If the stack isn't up:
```bash
docker compose -f infra/docker-compose.yml up -d --build
```
`--build` matters again this phase — `worker.py` and the EMQX authorization logic both
changed, and the images need rebuilding, not just a restart.

---

## Rule engine / hot path model

Rule evaluation happens **in the worker, in memory, before the storage-path Redis write**
(`worker.py::handle_message`) — CLAUDE.md §9's hardest constraint: no DB round-trip, queue
hop, or batch flush between message arrival and evaluation.

- **Only `threshold` rules are implemented** (CLAUDE.md §5 also lists `window`/`anomaly` as
  future types — the schema and `Evaluator` protocol are built to add them later without a
  redesign).
- **Flapping prevention is not bypassable**: `for_duration` (condition must hold this long
  before firing), `hysteresis` (must cross back past a margin, not just the bare threshold,
  before re-arming), and `cooldown` (minimum time between firings) are all enforced together
  in `rules/evaluators.py::ThresholdEvaluator` — see that file's docstring for the exact state
  machine. `RuleState` (armed/condition_since/last_fired_at) lives in the worker's memory per
  rule id; it does **not** survive a worker restart (this project's existing no-HA posture).
- **The rule cache is event-driven, not polled**: `rules/service.py` keeps an in-memory
  `dict[(device_id, metric), list[Rule]]`, loaded fully at worker startup and reloaded fully
  on every message on the `rules:invalidate` Redis pub/sub channel — a rule CRUD change
  reaches the hot path in well under a second, confirmed live.
- **A command fires two MQTT publishes**: `{tenant}/{device}/cmd/{actuator}` (QoS 1, carries
  `command_id`/`ttl`/`issued_at`) and a **retained** `{tenant}/{device}/state/{actuator}`
  (bare value) — so a device that reconnects later converges to the intended state without
  the platform tracking who missed what (CLAUDE.md §2). Both publishes reuse the worker's
  already-open MQTT connection — no new connection/handshake latency on the path being
  measured.
- **Acks close the loop**: the worker also subscribes to `{tenant}/{device}/ack/{actuator}`;
  `commands/service.py::record_ack` matches an incoming ack to its `Command` row by
  `command_id` and sets `acked_at`.
- **Webhook actions are real** (an `httpx` POST); **notification actions are a log-only
  stub** — no email provider exists in the codebase yet, and email isn't this phase's
  acceptance test.

---

## Endpoint reference

`🔒` = requires `Authorization: Bearer <access_token>`. `🏢` = also requires
`X-Tenant-Id: <tenant_id>` header. `👑` = requires admin or owner role in that tenant.

### Rules — `app/rules/`
| Method | Path | Notes |
|---|---|---|
| 🔒🏢 GET | `/devices/{device_id}/rules` | List rules for a device |
| 🔒🏢👑 POST | `/devices/{device_id}/rules` | Create a threshold rule |
| 🔒🏢 GET | `/rules/{id}` | Cross-tenant IDs 404 (RLS, same pattern as devices) |
| 🔒🏢👑 PATCH | `/rules/{id}` | Partial update — e.g. `{"enabled": false}` |
| 🔒🏢👑 DELETE | `/rules/{id}` | Delete |

### Commands — `app/commands/` (audit log, read-only this phase)
| Method | Path | Notes |
|---|---|---|
| 🔒🏢 GET | `/devices/{device_id}/commands` | Recent commands: actuator, value, latency_ms, acked_at |

---

## Try it from the command line

Requires a device already registered (`docs/phase-1-backend-core.md`'s walkthrough) and its
tenant slug (`docs/phase-2-mqtt-ingestion.md`'s walkthrough).

```bash
ACCESS="<access_token>"; TENANT="<tenant_id>"
DEVICE_ID="<credential.username>"; DEVICE_SECRET="<credential.password>"
TENANT_SLUG="<tenants.slug>"; DEVICE_SLUG="<device.slug>"

# 1. Create a threshold rule: temperature > 30 -> turn on fan1
curl -s -X POST "http://localhost:8000/devices/$DEVICE_ID/rules" \
  -H "authorization: Bearer $ACCESS" -H "x-tenant-id: $TENANT" \
  -H 'content-type: application/json' \
  -d '{"metric":"temperature","operator":">","threshold":30.0,"action":{"type":"actuator_command","actuator":"fan1","value":true}}'

# 2. In one terminal, watch for the command (and the retained desired state)
mosquitto_sub -h localhost -p 1883 -u "$DEVICE_ID" -P "$DEVICE_SECRET" \
  -t "$TENANT_SLUG/$DEVICE_SLUG/cmd/fan1" -t "$TENANT_SLUG/$DEVICE_SLUG/state/fan1" -v

# 3. In another terminal, publish a breaching reading
mosquitto_pub -h localhost -p 1883 -u "$DEVICE_ID" -P "$DEVICE_SECRET" \
  -t "$TENANT_SLUG/$DEVICE_SLUG/temperature" -m '{"value":35.0}'
```
The `cmd` message (`{"value":true,"issued_at":...,"ttl":30,"command_id":"..."}`) and the
retained `state` message (`{"value":true}`) should both appear within a couple hundred
milliseconds. Reconnecting `mosquitto_sub` to just the `state` topic afterward — with no new
breach — should show the retained value immediately.

```bash
# 4. Check the audit log
curl -s "http://localhost:8000/devices/$DEVICE_ID/commands" \
  -H "authorization: Bearer $ACCESS" -H "x-tenant-id: $TENANT"

# 5. Disable the rule and confirm it stops firing (near-instant, not a stale cache)
curl -s -X PATCH "http://localhost:8000/rules/<rule_id>" \
  -H "authorization: Bearer $ACCESS" -H "x-tenant-id: $TENANT" \
  -H 'content-type: application/json' -d '{"enabled":false}'
mosquitto_pub -h localhost -p 1883 -u "$DEVICE_ID" -P "$DEVICE_SECRET" \
  -t "$TENANT_SLUG/$DEVICE_SLUG/temperature" -m '{"value":40.0}'   # no command this time
```

---

## Running the automated tests

```bash
cd backend
uv run pytest              # 119 tests total
uv run ruff check .
uv run mypy src/app
```

New this phase: `tests/unit/test_rule_evaluators.py` — exhaustive per CLAUDE.md's explicit
mandate (boundary values at exactly the threshold, `for_duration` held/not-held/exactly-met,
hysteresis re-arm for every operator direction, cooldown suppression, rapid oscillation
around the bare threshold asserted to **not** refire, and a full multi-step lifecycle
scenario) — plus `tests/integration/test_rules.py` (CRUD, role-gating, RLS isolation) and
`tests/integration/test_commands.py` (`evaluate_and_dispatch` end-to-end with a mocked
`aiomqtt.Client`, webhook dispatch, notification stub, ack recording).

Migrations must be applied to **both** databases before running tests:
```bash
uv run alembic upgrade head
DATABASE_URL='postgresql+asyncpg://iot:iot_dev_password@127.0.0.1:5432/iot_test' \
  uv run alembic upgrade head
```

**Test infra note:** `tests/conftest.py`'s DB/Redis-touching autouse fixtures moved to
`tests/integration/conftest.py`. They were previously autouse at the shared `tests/` root,
so every pure unit test was opening a real Postgres connection for no reason — harmless at
12 unit tests, but the new 31-test evaluator suite pushed rapid connection churn into a real
hang. `tests/unit/` now has zero DB/Redis fixture overhead and runs in under a second.

---

## Where the code lives

```
backend/
├─ alembic/versions/          # +3 migrations: rules table, commands table,
│                              # rule cache lookup function
├─ src/app/
│  ├─ worker.py                 # +rule_cache_loop (3rd loop); handle_message now
│  │                             # evaluates rules before the telemetry XADD; also
│  │                             # subscribes to ack topics
│  ├─ db.py                     # +add_post_commit_callback (see below)
│  ├─ ingestion/router.py       # emqx_authorize: worker can now publish cmd/state,
│  │                             # subscribe to ack, in addition to telemetry
│  ├─ rules/                    # models, evaluators.py (pure state machine), service
│  │                             # (CRUD + worker-side cache + hot-path dispatch), router
│  └─ commands/                 # models (audit log), service (dispatch_command,
│                                 # record_ack), router (read-only listing)
└─ tests/
   ├─ unit/test_rule_evaluators.py
   └─ integration/test_rules.py, test_commands.py
```

---

## Notable design decisions

**Rule-invalidation pub/sub had to move to a post-commit callback.** Originally
`rules/service.py` published the Redis invalidation message right after `session.flush()`,
inside the still-open request transaction. Confirmed live: the worker's reload could race
ahead of the commit and see zero rows (`"rule cache reloaded: 0 active rules"` logged
immediately after successfully creating a rule) — a different Postgres connection can't see
this transaction's writes until it actually commits, no matter how fast the pub/sub message
arrives. Fixed with a general-purpose primitive, not a one-off patch:
`db.add_post_commit_callback(session, callback)` registers an async callback that
`get_session()` runs only after the transaction commits successfully. Anything else that
needs "only after this really commits" semantics can use the same mechanism.

**The worker-side rule cache uses the same SECURITY DEFINER escape hatch as Phase 2's device
lookups.** `rules` has RLS like every other tenant-scoped table, but the worker's cache load
needs every tenant's active rules at once — the same chicken-and-egg problem devices had.
`list_enabled_rules()` (the `add_rule_cache_lookup_function` migration) is the narrow,
auditable exception, `EXECUTE`-only granted to `iot_app`; the rule CRUD API itself stays
fully RLS-protected.

**`RuleState` is mutated in place by the evaluator — deliberately.** CLAUDE.md's `Evaluator`
protocol is pure and synchronous (no I/O, no awaits), but "pure" here means no I/O and no
externally-visible side effects beyond the caller's own `state` argument — not strict
functional immutability. Mutating the passed-in state is the mechanism by which
`for_duration`/hysteresis/cooldown tracking works at all, and it's exactly as easy to test
exhaustively either way (see the evaluator unit tests).

---

## What's deliberately not in this phase

- **EMQX's built-in Rule Engine as a broker-level backstop** — PLAN.md calls this optional,
  dashboard/deployment config, not code.
- **Manual actuator-trigger HTTP endpoint** ("buttons/toggles") — Phase 4 (dashboard)
  territory. `commands.service.dispatch_command` is generic enough to be reused then, but no
  endpoint is exposed now (`Command.rule_id` is nullable specifically to allow this later).
- **Real email delivery** — notification actions are a log-only stub this phase.
- **Rule state surviving a worker restart** — in-memory only; a restart resets
  `for_duration`/hysteresis/cooldown tracking.
- **`window`/`anomaly` rule types** — schema and `Evaluator` protocol are extensible, only
  `ThresholdEvaluator` exists.

## Known observations (not fully root-caused, not touched this phase)

- **`infra/.env` is committed to git with real-looking credentials** — flagged in Phase 1,
  left as-is per an explicit decision at the time. Worth revisiting before this ever goes
  near a shared or production environment.
- **A transient "read-your-own-write" delay was observed live, right after a fresh container
  restart**: a just-registered user or just-created device was occasionally not yet visible
  to the very next request for a few seconds, then resolved and never recurred. Reproduced
  outside the automated suite only (which uses a different connection pattern per test and
  never showed it across many full runs). Not the same bug as the rule-invalidation race
  above — that one was deterministic and is fixed; this one is intermittent, environment-
  specific, and unexplained. Worth a closer look if it shows up again, especially right after
  a cold start.
