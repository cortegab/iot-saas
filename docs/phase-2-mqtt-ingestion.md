# Phase 2 — MQTT Ingestion & Storage Path: deliverables & how to test them

Companion doc to `PLAN.md`'s "Phase 2 — MQTT ingestion & storage path" section. This is a map
of what got built, where the code lives, and how to poke at it yourself.

**Milestone met:** `mosquitto_pub` to a device topic, with the device's real credentials —
the reading lands in TimescaleDB within seconds and is queryable through the REST API.
Verified live against the running stack, including both auth failure and cross-device topic
denial at the EMQX broker level (not just in tests).

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
The `--build` matters this phase — `worker.py` changed significantly and the image needs
rebuilding, not just a restart.

---

## Auth model

MQTT is no longer anonymous. Every client authenticates through EMQX's HTTP auth backend,
which calls back into this API — configured **declaratively** in `infra/emqx/emqx.conf`
(mounted into the container), not through the dashboard, so `docker compose up` reproduces the
whole setup with no manual clicking.

- **Devices** connect with `username = device.id` (a UUID, globally unique — see "Notable
  design decisions" below for why this changed from Phase 1's `device.slug`) and
  `password = <the credential shown once at creation/rotation>`. EMQX POSTs these to
  `POST /ingestion/emqx/authenticate`; the same call also happens for the HTTP fallback via
  Basic auth. A device is restricted to its own topic subtree
  (`{tenant_slug}/{device_slug}/...`) via `POST /ingestion/emqx/authorize`.
- **The worker** connects with its own fixed system credential
  (`MQTT_WORKER_USERNAME`/`MQTT_WORKER_PASSWORD` — not a row in `devices`), authorized to
  *subscribe only* to `+/+/+`, never publish.
- Both EMQX callbacks require an `X-Emqx-Auth-Secret` header (`EMQX_AUTH_SHARED_SECRET`) so
  they can't be hit by arbitrary traffic reaching the `api` container.

---

## Endpoint reference

`🔒` = requires `Authorization: Bearer <access_token>`. `🏢` = also requires
`X-Tenant-Id: <tenant_id>` header.

### Ingestion — `app/ingestion/`
| Method | Path | Notes |
|---|---|---|
| POST | `/ingest` | HTTP REST fallback. Basic auth: `username=<device.id>`, `password=<secret>` |
| POST | `/ingestion/emqx/authenticate` | Internal — EMQX calls this, not a client |
| POST | `/ingestion/emqx/authorize` | Internal — EMQX calls this, not a client |

### Telemetry — `app/telemetry/`
| Method | Path | Notes |
|---|---|---|
| 🔒🏢 GET | `/devices/{id}/latest` | Most recent reading per metric for this device |
| 🔒🏢 GET | `/devices/{id}/data?metric=&from=&to=&resolution=` | `resolution` is `raw`, `1m`, or `1h` — the latter two hit continuous aggregates, never raw telemetry |

---

## Try it from the command line

Requires a device already registered (see `docs/phase-1-backend-core.md`'s walkthrough) —
`credential.username` is the device's `id`, `credential.password` is its secret, both shown
once at creation.

```bash
ACCESS="<access_token>"
TENANT="<tenant_id>"
DEVICE_ID="<credential.username from device creation>"
DEVICE_SECRET="<credential.password from device creation>"
TENANT_SLUG="<from GET /tenants (or psql tenants.slug)>"
DEVICE_SLUG="<device.slug from device creation>"

# 1. Publish real telemetry over MQTT with the device's own credentials
mosquitto_pub -h localhost -p 1883 \
  -u "$DEVICE_ID" -P "$DEVICE_SECRET" \
  -t "$TENANT_SLUG/$DEVICE_SLUG/temperature" -m '{"value":31.5}'

# 2. Confirm it landed, queryable through REST within a second or two
curl -s "http://localhost:8000/devices/$DEVICE_ID/latest" \
  -H "authorization: Bearer $ACCESS" -H "x-tenant-id: $TENANT"

# 3. Or via the HTTP fallback instead of MQTT
curl -s -X POST http://localhost:8000/ingest \
  -u "$DEVICE_ID:$DEVICE_SECRET" \
  -H 'content-type: application/json' \
  -d '{"metric":"temperature","value":22.1}'
```

Confirm the negative cases too — both are enforced by EMQX itself, at the broker, before
anything reaches the worker:
```bash
# Wrong password -> connection refused (CONNACK 5)
mosquitto_pub -h localhost -p 1883 -u "$DEVICE_ID" -P "wrong" \
  -t "$TENANT_SLUG/$DEVICE_SLUG/temperature" -m '{"value":1}'

# Publishing outside this device's own topic subtree -> silently denied
# (QoS 0 gives no client-side error; check `docker logs iot-saas-emqx-1` for
# "cannot_publish_to_topic_due_to_not_authorized")
mosquitto_pub -h localhost -p 1883 -u "$DEVICE_ID" -P "$DEVICE_SECRET" \
  -t "$TENANT_SLUG/some-other-device/temperature" -m '{"value":99}'
```

---

## Running the automated tests

```bash
cd backend
uv run pytest              # 73 tests total: 49 from Phase 1 + 24 new
uv run ruff check .
uv run mypy src/app
```

New this phase: `tests/unit/test_topic_parsing.py` (pure `parse_topic` edge cases),
`tests/integration/test_ingestion.py` (HTTP fallback auth, EMQX auth/authz callback
contracts — device and worker-system-credential paths, cross-device denial), and
`tests/integration/test_telemetry.py` (`/latest`, `/data`, resolution selection, cross-tenant
404, and a real continuous-aggregate refresh + rollup-correctness check).

`test_ingestion.py` monkeypatches the shared Redis client's `xadd` — the ingest endpoint
pushes onto the same stream the live dev worker container drains, so tests never let a real
`XADD` reach it (test data referencing `iot_test`-only ids would otherwise fail the worker's
FK-constrained insert against the entirely separate dev database).

Migrations must be applied to **both** databases before running tests — the dev one and
`iot_test`:
```bash
uv run alembic upgrade head
DATABASE_URL='postgresql+asyncpg://iot:iot_dev_password@127.0.0.1:5432/iot_test' \
  uv run alembic upgrade head
```

---

## Where the code lives

```
backend/
├─ alembic/versions/          # +3 migrations: device auth lookup functions,
│                              # telemetry hypertable, continuous aggregates
├─ src/app/
│  ├─ worker.py                # rewritten: mqtt_ingest_loop + stream_writer_loop
│  ├─ redis.py                 # shared Redis client (api + worker both import this)
│  ├─ ingestion/                # topic parsing, device directory cache, HTTP fallback,
│  │                            # EMQX auth/authz callbacks
│  ├─ telemetry/                # query API over raw + rollup tables
│  └─ devices/                  # +lookup_device_for_auth/lookup_device_by_slug
└─ tests/
   ├─ unit/test_topic_parsing.py
   └─ integration/test_ingestion.py, test_telemetry.py

infra/
├─ emqx/emqx.conf              # declarative HTTP auth/authz config
└─ docker-compose.yml          # emqx.conf mount + new env vars on emqx/api/worker
```

---

## Notable design decisions

**`telemetry` has no Row-Level Security**, unlike every other tenant-scoped table.
TimescaleDB compression and RLS cannot coexist on the same hypertable — confirmed against
the running TimescaleDB version (`FeatureNotSupportedError: compression cannot be used on
table with row security`) and against TimescaleDB's own open issues
(timescale/timescaledb#6827, #7830 — the security-barrier-view workaround is blocked by the
same restriction, #6425). Compression was chosen over RLS for this one table (PLAN.md calls
deferred compression "the single biggest cost risk in the project"); tenant isolation is
enforced at the application layer instead — every query in `telemetry/service.py` filters
explicitly by `tenant_id`. See the `create_telemetry_hypertable` migration's docstring and
`telemetry/service.py`'s module docstring.

**Device auth resolution uses a SECURITY DEFINER Postgres function**, not a raw/superuser
bypass. EMQX's auth callback and the HTTP ingest fallback need to resolve a device by id with
*no* tenant context yet — that's the whole point, verifying credentials is how the tenant
gets discovered — but `devices` fails closed with no context by design (Phase 1's explicit
test for this). `lookup_device_for_auth`/`lookup_device_by_slug`
(`add_device_auth_lookup_functions` migration) are the one narrow, auditable exception:
owned by the migration role so they bypass RLS internally, `EXECUTE`-only granted to
`iot_app`, returning only the columns each caller needs. Everything else about `devices`
stays exactly as RLS-protected as before.

**MQTT username changed from `device.slug` to `device.id`.** Phase 1 used slug, which is
only unique per tenant — ambiguous for EMQX's auth callback (no tenant context at CONNECT
time) and inconsistent with CLAUDE.md §8's own worked example (`-u <device_id>`). Fixed as
part of this phase; `device.slug` is still used in the MQTT *topic* (human-readable), just
not as the auth username.

---

## What's deliberately not in this phase

- Real MQTT/TLS on 8883 + certbot renewal — a VPS/deployment step, not code; there's no VPS
  provisioned yet
- Per-tenant retention by plan — Phase 5 (billing); a global 90-day default is set for now
- Rule evaluation, the in-memory hot path, and actuator commands — Phase 3. This phase is the
  storage path only; the device directory cache in `ingestion/service.py` was deliberately
  built so Phase 3's rule evaluator can reuse it rather than rebuild one
- **Known gap for Phase 3:** the worker's EMQX identity is currently subscribe-only.
  Phase 3's Command Service will need `emqx_authorize`'s worker-identity branch extended to
  also allow publishing to `cmd`/`state` topics

## Known pre-existing issue (not touched this phase)

`infra/.env` is committed to git with real-looking credentials — flagged earlier in this
project and left as-is per an explicit decision at the time. Worth revisiting before this
ever goes near a shared or production environment.
