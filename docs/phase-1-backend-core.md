# Phase 1 — Backend Core: deliverables & how to test them

Companion doc to `PLAN.md`'s "Phase 1 — Backend core" section. This is a map of what got
built, where the code lives, and how to poke at it yourself.

**Milestone met:** register a user → tenant auto-created → device registered → its
credential retrieved once — all through authenticated REST calls, with Postgres Row-Level
Security proven to block cross-tenant reads.

---

## Local URLs (stack already running via Docker Compose)

| What | URL |
|---|---|
| **Interactive API docs (Swagger UI)** | **http://localhost:8000/docs** — try every endpoint below from the browser |
| Alternate API docs (ReDoc) | http://localhost:8000/redoc |
| Raw OpenAPI schema | http://localhost:8000/openapi.json |
| Health check | http://localhost:8000/health |
| Frontend (Phase 0 skeleton, unchanged this phase) | http://localhost:3000 |
| EMQX dashboard | http://localhost:18083 |

If the stack isn't up:
```bash
docker compose -f infra/docker-compose.yml up -d
```

**Fastest way to explore it:** open http://localhost:8000/docs, expand `POST /auth/register`,
click "Try it out", fill in an email/password/tenant_name, and execute. Copy the
`access_token` and the `tenant_id` from the response into the "Authorize" button (or the
`X-Tenant-Id` field on other endpoints) to call the rest of the API from the same page.

---

## Endpoint reference

`🔒` = requires `Authorization: Bearer <access_token>`. `🏢` = also requires
`X-Tenant-Id: <tenant_id>` header. `👑` = requires admin or owner role in that tenant.

### Auth — `app/auth/`
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | Creates user + their first tenant (as owner), returns token pair |
| POST | `/auth/login` | Returns token pair + list of tenant memberships |
| POST | `/auth/refresh` | Rotates the refresh token; replaying an old one revokes the whole rotation family |
| POST | `/auth/logout` | Revokes a refresh token |

### Tenants — `app/tenants/`
| Method | Path | Notes |
|---|---|---|
| 🔒 GET | `/tenants/mine` | Every tenant the caller belongs to, with their role in each |
| 🔒 POST | `/tenants` | Create an additional tenant (caller becomes owner) |
| 🔒🏢 GET | `/tenants/members` | List members of the tenant in `X-Tenant-Id` |
| 🔒🏢👑 POST | `/tenants/members` | Add a member by email (must already have an account) |
| 🔒🏢👑 PATCH | `/tenants/members/{user_id}` | Change a member's role |
| 🔒🏢👑 DELETE | `/tenants/members/{user_id}` | Remove a member |

### Devices — `app/devices/`
| Method | Path | Notes |
|---|---|---|
| 🔒🏢 GET | `/devices` | List devices in the current tenant |
| 🔒🏢👑 POST | `/devices` | Create a device — returns its MQTT credential **once** |
| 🔒🏢 GET | `/devices/{id}` | Cross-tenant IDs return 404 (RLS makes the row invisible, not just forbidden) |
| 🔒🏢👑 PATCH | `/devices/{id}` | Rename / enable / disable |
| 🔒🏢👑 DELETE | `/devices/{id}` | Delete |
| 🔒🏢👑 POST | `/devices/{id}/rotate-credential` | Invalidates the old credential immediately |

### API keys — `app/api_keys/` (CRUD only this phase — not yet usable as a credential)
| Method | Path | Notes |
|---|---|---|
| 🔒🏢👑 GET | `/api-keys` | List keys (no secrets) |
| 🔒🏢👑 POST | `/api-keys` | Create — returns the full key **once** |
| 🔒🏢👑 DELETE | `/api-keys/{id}` | Revoke |

---

## Try it from the command line

```bash
# 1. Register — creates your first tenant automatically
curl -s -X POST http://localhost:8000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"demo@example.com","password":"correct horse battery staple","tenant_name":"Demo Co"}'
```

Grab `access_token` and `memberships[0].tenant_id` from the response, then:

```bash
ACCESS="<access_token from above>"
TENANT="<tenant_id from above>"

# 2. Register a device — the credential.password is shown ONCE
curl -s -X POST http://localhost:8000/devices \
  -H "authorization: Bearer $ACCESS" -H "x-tenant-id: $TENANT" \
  -H 'content-type: application/json' -d '{"name":"Sensor 1"}'

# 3. List devices (credential no longer appears)
curl -s http://localhost:8000/devices \
  -H "authorization: Bearer $ACCESS" -H "x-tenant-id: $TENANT"

# 4. See your memberships
curl -s http://localhost:8000/tenants/mine -H "authorization: Bearer $ACCESS"
```

Register a **second** account with a different email/tenant name and confirm its
`GET /devices` never returns the first tenant's device — that's the RLS guarantee in action.

---

## Running the automated tests

```bash
cd backend
uv run pytest              # 49 tests: unit (hashing, JWT) + integration (real Postgres, no mocks)
uv run ruff check .
uv run ruff format --check .
uv run mypy src/app
```

The centerpiece is `tests/integration/test_rls_isolation.py` — proves Row-Level Security at
the Postgres level (admin bypass, fail-closed with no context, DB-level policy enforcement,
end-to-end 404-not-403, and `WITH CHECK` blocking a cross-tenant insert).

---

## Where the code lives

```
backend/
├─ alembic/versions/         # 6 migrations: users, tenants, tenant_memberships,
│                             # refresh_tokens, devices, api_keys
├─ src/app/
│  ├─ db.py                  # engine, get_session, set_user_context/set_tenant_context
│  ├─ auth/                  # register/login/refresh/logout, hashing, JWT
│  ├─ tenants/                # membership, RLS tenant-context dependency, role checks
│  ├─ devices/                # CRUD + credential generation
│  └─ api_keys/               # CRUD (create/list/revoke)
└─ tests/
   ├─ unit/                  # password hashing, JWT
   └─ integration/           # auth flow, tenant membership, devices, api keys, RLS isolation
```

## What's deliberately not in this phase

- Email verification / password reset (deferred)
- API keys as a working auth method (CRUD only — see `app/api_keys/models.py` docstring)
- MQTT wiring for device credentials (Phase 2 — and note EMQX's built-in Postgres-auth
  backend doesn't support argon2, so Phase 2 will need EMQX's HTTP auth backend instead)

## Known pre-existing issue (not touched this phase)

`infra/.env` is committed to git with real-looking credentials — flagged earlier in this
project and left as-is per an explicit decision at the time. Worth revisiting before this
ever goes near a shared or production environment.
