# Phase 1 — Manual test walkthrough

A step-by-step script for a human to click/paste through the whole Phase 1 backend and
confirm it behaves as designed — auth, tenants, membership, devices, API keys, and
cross-tenant isolation.

Two ways to follow along:
- **Swagger UI** (http://localhost:8000/docs) — click "Try it out" on each endpoint, paste
  the body shown, hit Execute. Use the "Authorize" button (top right) to paste
  `Bearer <access_token>` once logged in, and each tenant-scoped endpoint has an
  `X-Tenant-Id` parameter field to fill in.
- **curl** — every step below has a copy-pasteable command. Commands build on each other:
  run them in order, in the same terminal, so the shell variables carry over.

Stack must be running: `docker compose -f infra/docker-compose.yml up -d`

**Prerequisites for the curl path:** the commands below use `jq` to pull fields out of
JSON responses. Install it once if you don't have it: `sudo apt-get install -y jq` (WSL/
Ubuntu) or `brew install jq` (macOS). Following along in Swagger UI instead needs nothing
extra — just copy values by hand from each response.

---

## Part 1 — Register and log in

**1. Register the first account.** This creates the user *and* their first tenant
(you become its owner) in one call.

```bash
curl -s -X POST http://localhost:8000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"correct horse battery staple","tenant_name":"Acme"}' | tee /tmp/owner.json
```

✅ Expect `201`, an `access_token`, a `refresh_token`, and `memberships` containing one
entry with `role: "owner"`.

```bash
OWNER_ACCESS=$(jq -r '.access_token' /tmp/owner.json)
OWNER_REFRESH=$(jq -r '.refresh_token' /tmp/owner.json)
TENANT_ID=$(jq -r '.memberships[0].tenant_id' /tmp/owner.json)
```

**2. Try registering the same email again.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"anything12","tenant_name":"Whatever"}'
```
✅ Expect `409` (email already registered).

**3. Log in instead of registering.**

```bash
curl -s -X POST http://localhost:8000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"correct horse battery staple"}'
```
✅ Expect `200` with a fresh token pair.

**4. Try the wrong password.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"wrong"}'
```
✅ Expect `401`.

---

## Part 2 — Tenants and membership

**5. List "my" tenants.**

```bash
curl -s http://localhost:8000/tenants/mine -H "authorization: Bearer $OWNER_ACCESS"
```
✅ Expect one tenant, role `owner`.

**6. Create a second tenant** (same account can own multiple).

```bash
curl -s -X POST http://localhost:8000/tenants \
  -H "authorization: Bearer $OWNER_ACCESS" -H 'content-type: application/json' \
  -d '{"name":"Side Project"}'
```
✅ Expect `201`. Re-run step 5's `GET /tenants/mine` — you should now see two tenants,
both owned by you.

**7. Register a second user** to invite into Acme.

```bash
curl -s -X POST http://localhost:8000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"viewer@example.com","password":"hunter2hunter2","tenant_name":"ViewerOwnCo"}' | tee /tmp/viewer.json

VIEWER_ACCESS=$(jq -r '.access_token' /tmp/viewer.json)
```

**8. Add them to Acme as a viewer.**

```bash
curl -s -X POST http://localhost:8000/tenants/members \
  -H "authorization: Bearer $OWNER_ACCESS" -H "x-tenant-id: $TENANT_ID" \
  -H 'content-type: application/json' \
  -d '{"email":"viewer@example.com","role":"viewer"}'
```
✅ Expect `201`, `role: "viewer"`.

**9. List Acme's members.**

```bash
curl -s http://localhost:8000/tenants/members \
  -H "authorization: Bearer $OWNER_ACCESS" -H "x-tenant-id: $TENANT_ID"
```
✅ Expect two members: `owner@example.com` (owner), `viewer@example.com` (viewer).

**10. Confirm the viewer can read but not manage members** — try adding a member as the viewer:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/tenants/members \
  -H "authorization: Bearer $VIEWER_ACCESS" -H "x-tenant-id: $TENANT_ID" \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","role":"viewer"}'
```
✅ Expect `403` (viewer role, action requires admin+).

---

## Part 3 — Devices

**11. Create a device as the owner** — the credential is shown **once**, right here.

```bash
curl -s -X POST http://localhost:8000/devices \
  -H "authorization: Bearer $OWNER_ACCESS" -H "x-tenant-id: $TENANT_ID" \
  -H 'content-type: application/json' -d '{"name":"Sensor 1"}' | tee /tmp/device.json

DEVICE_ID=$(jq -r '.device.id' /tmp/device.json)
echo "MQTT username: $(jq -r '.device.slug' /tmp/device.json)"
echo "MQTT password (save this — you won't see it again): $(jq -r '.credential.password' /tmp/device.json)"
```
✅ Expect `201` with `device` and `credential` objects.

**12. Confirm the viewer cannot create a device.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/devices \
  -H "authorization: Bearer $VIEWER_ACCESS" -H "x-tenant-id: $TENANT_ID" \
  -H 'content-type: application/json' -d '{"name":"Sensor 2"}'
```
✅ Expect `403`.

**13. Confirm the viewer *can* list devices.**

```bash
curl -s http://localhost:8000/devices \
  -H "authorization: Bearer $VIEWER_ACCESS" -H "x-tenant-id: $TENANT_ID"
```
✅ Expect `200` with `Sensor 1` in the list — and note the credential is **not** in this
response, only in the one-time create response from step 11.

**14. Update the device.**

```bash
curl -s -X PATCH http://localhost:8000/devices/$DEVICE_ID \
  -H "authorization: Bearer $OWNER_ACCESS" -H "x-tenant-id: $TENANT_ID" \
  -H 'content-type: application/json' -d '{"status":"disabled"}'
```
✅ Expect `200`, `status: "disabled"`.

**15. Rotate its credential** — the old password stops working, a new one is issued.

```bash
curl -s -X POST http://localhost:8000/devices/$DEVICE_ID/rotate-credential \
  -H "authorization: Bearer $OWNER_ACCESS" -H "x-tenant-id: $TENANT_ID"
```
✅ Expect `200` with a **different** password than step 11's.

**16. Delete the device.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:8000/devices/$DEVICE_ID \
  -H "authorization: Bearer $OWNER_ACCESS" -H "x-tenant-id: $TENANT_ID"
```
✅ Expect `204`. Then confirm it's really gone:
```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/devices/$DEVICE_ID \
  -H "authorization: Bearer $OWNER_ACCESS" -H "x-tenant-id: $TENANT_ID"
```
✅ Expect `404`.

---

## Part 4 — API keys (CRUD only — not usable as a credential yet)

**17. Create a key.**

```bash
curl -s -X POST http://localhost:8000/api-keys \
  -H "authorization: Bearer $OWNER_ACCESS" -H "x-tenant-id: $TENANT_ID" \
  -H 'content-type: application/json' -d '{"name":"CI key","role":"viewer"}' | tee /tmp/apikey.json

KEY_ID=$(jq -r '.api_key.id' /tmp/apikey.json)
```
✅ Expect `201`, a `key` field starting with `iot_` — that's shown once too.

**18. List keys** — confirm the secret isn't there, only a `key_prefix`.

```bash
curl -s http://localhost:8000/api-keys \
  -H "authorization: Bearer $OWNER_ACCESS" -H "x-tenant-id: $TENANT_ID"
```

**19. Revoke it.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:8000/api-keys/$KEY_ID \
  -H "authorization: Bearer $OWNER_ACCESS" -H "x-tenant-id: $TENANT_ID"
```
✅ Expect `204`. Re-list — the key is still there but `revoked_at` is now set.

---

## Part 5 — Refresh tokens: rotation and reuse detection

**20. Refresh the owner's session.**

```bash
curl -s -X POST http://localhost:8000/auth/refresh \
  -d "{\"refresh_token\":\"$OWNER_REFRESH\"}" -H 'content-type: application/json' | tee /tmp/refreshed.json

NEW_REFRESH=$(jq -r '.refresh_token' /tmp/refreshed.json)
```
✅ Expect `200` with a **new** refresh token, different from `$OWNER_REFRESH`.

**21. Replay the *old* refresh token** (simulating a stolen/leaked token being reused):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/auth/refresh \
  -d "{\"refresh_token\":\"$OWNER_REFRESH\"}" -H 'content-type: application/json'
```
✅ Expect `401` — and this **also revokes the token from step 20**, even though that one
hadn't been used yet:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/auth/refresh \
  -d "{\"refresh_token\":\"$NEW_REFRESH\"}" -H 'content-type: application/json'
```
✅ Expect `401` too — this is the reuse-detection behavior: one leaked token poisons the
whole chain, not just itself. (This means the owner's session is now fully logged out —
re-run step 1's login to get a fresh session before continuing.)

**22. Log out cleanly.**

```bash
curl -s -X POST http://localhost:8000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"correct horse battery staple"}' | tee /tmp/relogin.json
FRESH_REFRESH=$(jq -r '.refresh_token' /tmp/relogin.json)

curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/auth/logout \
  -d "{\"refresh_token\":\"$FRESH_REFRESH\"}" -H 'content-type: application/json'
```
✅ Expect `204`, then confirm the refresh token no longer works (`401` on `/auth/refresh`).

---

## Part 6 — Cross-tenant isolation (the whole point of Phase 1)

**23. Register a completely separate account/tenant.**

```bash
curl -s -X POST http://localhost:8000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"outsider@example.com","password":"hunter2hunter2","tenant_name":"OtherCo"}' | tee /tmp/outsider.json

OUTSIDER_ACCESS=$(jq -r '.access_token' /tmp/outsider.json)
```

**24. Try to read Acme's members using the outsider's token but Acme's tenant ID.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/tenants/members \
  -H "authorization: Bearer $OUTSIDER_ACCESS" -H "x-tenant-id: $TENANT_ID"
```
✅ Expect `403` — not a member, rejected before any tenant data is touched.

**25. Create a device under the outsider's own tenant, then confirm the owner
account can't see it, and vice versa.**

```bash
OUTSIDER_TENANT=$(jq -r '.memberships[0].tenant_id' /tmp/outsider.json)

curl -s -X POST http://localhost:8000/devices \
  -H "authorization: Bearer $OUTSIDER_ACCESS" -H "x-tenant-id: $OUTSIDER_TENANT" \
  -H 'content-type: application/json' -d '{"name":"Outsider Sensor"}' | tee /tmp/outsider_device.json

OUTSIDER_DEVICE_ID=$(jq -r '.device.id' /tmp/outsider_device.json)

# Owner's device list must not include the outsider's device:
curl -s http://localhost:8000/devices \
  -H "authorization: Bearer $OWNER_ACCESS" -H "x-tenant-id: $TENANT_ID"

# And fetching the outsider's device ID directly, as the owner, must 404 — not 403 —
# because Row-Level Security makes the row genuinely invisible, not merely forbidden:
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/devices/$OUTSIDER_DEVICE_ID \
  -H "authorization: Bearer $OWNER_ACCESS" -H "x-tenant-id: $TENANT_ID"
```
✅ Expect the device list to omit "Outsider Sensor", and the direct fetch to return `404`.

---

## Cleanup

Nothing above needs cleanup for correctness (Postgres RLS makes stale test data harmless —
each account only ever sees its own), but if you want a clean slate:

```bash
docker compose -f infra/docker-compose.yml exec timescaledb psql -U iot -d iot -c \
  "TRUNCATE users, tenants, tenant_memberships, refresh_tokens, devices, api_keys RESTART IDENTITY CASCADE;"
```

## If something doesn't match ✅

Check `docker compose -f infra/docker-compose.yml logs api --tail 50` for a stack trace,
and see [docs/phase-1-backend-core.md](phase-1-backend-core.md) for the endpoint reference
and where each piece of code lives.
