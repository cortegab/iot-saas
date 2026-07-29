# infra — development stack

Docker Compose setup that runs the whole `iot-saas` stack locally: TimescaleDB, Redis, EMQX, plus
the `api`, `worker`, and `frontend` containers with source bind-mounted for hot reload.

> These app containers are **Phase 0 skeletons** — enough to boot the stack and prove the wiring end
> to end. Auth, migrations, the rule evaluator, and the batched writer arrive in later phases (see
> `PLAN.md`).

## Bring it up

From the repo root (`iot-saas/`):

```bash
cp infra/.env.example infra/.env
```

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

```bash
docker compose -f infra/docker-compose.yml ps
```

Wait for `timescaledb`, `redis`, and `emqx` to report **healthy** — `api` and `worker` start only
once they are.

| Service | URL | Notes |
|---|---|---|
| Frontend | http://localhost:3000 | Reports API health |
| API docs | http://localhost:8000/docs | OpenAPI / Swagger |
| API health | http://localhost:8000/health | `{"status":"ok"}` |
| EMQX dashboard | http://localhost:18083 | login `admin` / `public` — change it |

All ports are bound to `127.0.0.1` only.

## Verify the ingestion path

Publish a telemetry message (dev MQTT is plaintext on 1883, anonymous):

```bash
mosquitto_pub -h localhost -p 1883 -t "demo/sensor01/temperature" -m '{"value":31.5}'
```

Confirm the worker received it and pushed it onto the Redis stream:

```bash
docker compose -f infra/docker-compose.yml logs worker --tail 10
```

```bash
docker compose -f infra/docker-compose.yml exec redis redis-cli XLEN telemetry
```

## Optional dev tooling

pgAdmin and RedisInsight are opt-in via the `tools` profile:

```bash
docker compose -f infra/docker-compose.yml --profile tools up -d
```

| Tool | URL | Connect to |
|---|---|---|
| pgAdmin | http://localhost:5050 | host `timescaledb`, port `5432`, db/user/pass from `.env` |
| RedisInsight | http://localhost:5540 | host `redis`, port `6379` |

## Tear down

```bash
docker compose -f infra/docker-compose.yml down
```

Add `-v` to also delete the data volumes (Postgres, Redis, EMQX) for a clean slate.

## Notes

- **Dev only.** MQTT is plaintext and anonymous; TLS on 8883 and per-device auth/ACLs arrive in
  Phase 2. Do not use this configuration on a public host.
- Backend `api` and `worker` share one image and one codebase, differing only by launch command —
  the API never subscribes to MQTT, the worker never serves HTTP.
- Changing `backend/pyproject.toml` or `frontend/package.json` requires a rebuild
  (`up -d --build`); source edits hot-reload without one.
