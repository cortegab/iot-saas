# SCOPE.md: what iodriven does today

**Last reviewed:** 2026-10-07 · **Version:** 1.0 (in production at iodriven.tech) · **Up to:** PR #86

This is the single answer to "what does the product do, what doesn't it do, and what's next".

- **How it's built:** `CLAUDE.md`.
- **How the UI looks and behaves:** `docs/design/DESIGN.md`.
- **Area deep dives:** linked from each section below.

> **Keep it current.** A PR that adds, changes or drops a capability updates this file in the same
> PR, along with the *Last reviewed* line.

---

## 1. The product in one paragraph

iodriven is a multi-tenant IoT platform:
- **Ingest:** devices (ESP32-class boards, or anything that speaks MQTT over TLS) publish telemetry.
- **Decide:** every reading is checked against the workspace's rules **in memory, the moment it arrives**.
- **Act:** a firing rule switches actuators, emails people, posts in-app notifications or calls webhooks.
- **Watch and manage:** operators follow live dashboards and manage devices, templates, zones and members, all in a browser.

**Design point:**

| Requirement | Target |
|---|---|
| Breach → actuator command | **< 2 s** (typically < 500 ms) |
| Scale | **500–1,000 devices** per host |
| Infrastructure | **One Linux VPS** with Docker Compose |

**Status legend:** ✅ shipped · 🚧 partial · 🗓 planned · ❌ out of scope

---

## 2. Capability inventory

### Devices and onboarding

| Capability | Status | Notes |
|---|---|---|
| Device registry: create, edit (Settings tab), disable, delete, bulk actions | ✅ | List with online / offline / never connected / disabled KPIs, filters, peek drawer. |
| Per-device MQTT credential, stored hashed (argon2id), shown once, rotatable | ✅ | EMQX ACLs restrict each device to its own topic subtree. |
| Device templates: metrics (number or on/off, unit, decimals, range, publish cadence) and actuators | ✅ | Keys validated as topic segments; usage counts; a rename that would break rules or widgets is warned about. |
| Generated firmware sketch (ESP32 and ESP32-C3) with topics, TLS and credential filled in | ✅ | Pins common to the 30- and 38-pin DevKits; provisioning reset on GPIO 19 (C3: GPIO 9). |
| Wi-Fi from a phone: Espressif BLE provisioning (ESP BLE Prov app), QR from the device credential, Security 1 or 2 | ✅ | `docs/ble-provisioning.md`. Security 2 needs a matching phone app and esp32 board package (see §4). |
| 5-step connect flow with a live "waiting for first message" check and a test command | ✅ | |
| Zones (places devices live in), filter devices by zone | ✅ | A zone can't be deleted while devices are in it. |
| Device health: retained status topic, Last-Will offline, RSSI / battery / firmware / uptime | ✅ | |
| "Device went offline" notification | 🚧 | Fixed and on for every device; no "back online", can't be muted per device (§5). |
| Reconnect action for an offline device on its page | 🗓 | Today the Connect button shows only for never-connected devices. |
| HTTP REST ingest as a fallback to MQTT | ✅ | `POST /ingest`. |
| Non-MQTT protocols (OPC UA, Modbus, vendor clouds) | 🗓 | Only through an edge connector (§3); never in the platform core. |

### Telemetry and storage

| Capability | Status | Notes |
|---|---|---|
| MQTT ingestion with validation; a malformed message is dropped and logged, never stops the stream | ✅ | `docs/phase-2-mqtt-ingestion.md`. |
| Split path: rules on the in-memory hot path; Redis Stream → batched writer → TimescaleDB for history | ✅ | |
| Compression after 7 days; 1-minute and 1-hour continuous aggregates; dashboards read rollups | ✅ | |
| Retention | 🚧 | Fixed **90 days for every workspace**. Per-plan retention (7 days free / 90 paid) arrives with billing (§3). |
| Publish profiles pushed to devices (periodic / on change / streaming) | ✅ | Retained `config` topic. |
| Live updates in the browser over WebSocket | ✅ | |

### Rules and automation

| Capability | Status | Notes |
|---|---|---|
| Rules in plain WHEN / IF / THEN, edited as a **Form** or a **Ladder**, one layout for both | ✅ | `docs/rule-engine-multi-device.md`; DESIGN.md §9. |
| Triggers: on each reading, schedule (cron with presets), manual run, device online / offline | ✅ | |
| Conditions across several devices, ALL / ANY groups, comparison and range operators, metric vs metric | ✅ | |
| Hold time, hysteresis, cooldown on every rule (anti-flapping), latch until reset | ✅ | Cannot be bypassed (CLAUDE.md §9.7). |
| Actions on clear: run once when the condition is no longer true (e.g. turn the fan back off) | ✅ | Stale or missing data is *unknown*: it never fires, re-arms or clears. |
| Section validation: blocking problems vs safety warnings (amber "!", never block a save) | ✅ | |
| Recipes, live preview, "would send", 24-hour replay, dry run of unsaved edits | ✅ | |
| Rule versions with change lines and Restore; activity strips; execution history | ✅ | |
| Rule health (can it evaluate now?) | ✅ | |
| Custom evaluators / anomaly detection (ML) | 🗓 | Same `Evaluator` interface, in-process (§3). |

### Actions and notifications

| Capability | Status | Notes |
|---|---|---|
| Actuator commands: QoS 1, TTL, acknowledgement, retained desired state for reconnecting devices | ✅ | |
| Email action, sent as **"IO Driven Platform Alerts"** over SMTP (port 465 or 587) | ✅ | `EMAIL_*` / `SMTP_*` settings. |
| Webhook action | ✅ | |
| In-app notifications with severity and kind, read / unread, dismiss / undo | ✅ | |
| Failed deliveries list with reason and Retry | ✅ | |

### Dashboards

| Capability | Status | Notes |
|---|---|---|
| Personal dashboards: switcher, edit mode, drag / resize / remove | ✅ | Each member builds their own. |
| Widgets: value card, trend chart, gauge, device status, actuator control | ✅ | On/off metrics draw as step charts on an Off / On axis. |
| Stale values marked as stale, never shown as current | ✅ | |
| Shared / workspace dashboards, CSV export | 🗓 | CSV export was a paid-tier item in the billing plan. |

### Workspaces, people and access

| Capability | Status | Notes |
|---|---|---|
| Multi-tenant workspaces isolated by Postgres row-level security | ✅ | The telemetry hypertable is isolated by an explicit `tenant_id` filter instead (compression and RLS can't coexist). |
| Roles: Owner, Admin, Viewer; owner guards; leave a workspace | ✅ | |
| Member invitations by email (7-day link) and an accept page | ✅ | |
| Sign in / register / forgot and reset password; "Keep me signed in" | ✅ | |
| API keys as `Authorization: Bearer`, with expiry (Viewer or Admin) | ✅ | |
| Workspace settings: time zone, alert recipients | ✅ | |
| Command palette (⌘K), grouped sidebar, workspace switcher | ✅ | |

### Public site

| Capability | Status | Notes |
|---|---|---|
| Landing page at iodriven.tech: product tour, how it works, safety, onboarding, security, deployment options, FAQ | ✅ | DESIGN.md §10. |
| "Talk to us" contact form: emails `CONTACT_EMAIL_TO`, stores nothing, honeypot, 5 per address per hour | ✅ | |
| Public demo workspace, published plan tiers / pricing | ❌ | A deliberate decision for now. |

### Operations

| Capability | Status | Notes |
|---|---|---|
| Push-to-deploy to the VPS (GitHub Actions, `prod` branch), migrations on deploy, health check | ✅ | `.github/workflows/deploy-prod.yml`, `infra/README.md`. |
| TLS via Let's Encrypt with a renewal timer | ✅ | |
| Daily database backup (03:00) and a restore script with runbook | 🚧 | `infra/backups/`. Off-host copy is optional (`RCLONE_REMOTE`); **a restore drill has not been recorded yet** (CLAUDE.md §9.13). |
| Monitoring and alerting (disk, restarts, ingestion lag) | 🗓 | |
| Rate limiting at ingestion and on the REST API | 🗓 | Only the contact form is rate-limited today. |
| Automated test CI | ❌ | Tests run locally: backend `pytest`, frontend vitest and Playwright. |

---

## 3. Planned: the roadmap carried over from PLAN.md

These are the parts of the original staged plan that haven't been built. Each keeps the decisions that still matter, so `PLAN.md` can be archived without losing them.

### Billing and plan quotas (was Phase 5) 🗓

**Plan tiers (draft):**

| Plan | Price | Devices | History | Includes |
|---|---|---|---|---|
| Free | $0 | 2 | 7 days | 1 dashboard, 1 message every 5 s |
| Premium | $5 | 20 | 90 days | unlimited dashboards, CSV export |
| Control | $10 | 20 | 90 days | actuators, commands, rules |

**Scope:** Stripe Checkout and Customer Portal, quota enforcement (devices, message rate, dashboards), usage display and upgrade prompts.

**Keep in mind:**
- Enforce retention per plan **in the database**, so a downgrade actually reclaims storage.
- Handle Stripe webhooks idempotently.

### Production hardening (was Phase 6) 🚧

- Finish **off-host backups**, and **run and time the restore drill**. Restore time *is* the availability guarantee, because there's no high availability.
- Add monitoring and alerts:
  - disk above 80 %
  - container restarts
  - ingestion stalls
- Add log rotation.
- Complete a security review (dependency audit, EMQX defaults, rate limits).

### Dedicated single-tenant variant (was Phase 7) 🗓

- **Repo:** a separate `iot-dedicated` copy of the hardened core, without tenants, row-level security or billing.
- **White-label:** logo, colours, name and domain, all set from configuration.
- **Client extensions:** a loader for client-specific evaluators, and integration adapters.
- **Deployment:** one deployment per client.
- **Shared contract:** the device contract (CLAUDE.md §4) is shared, so the same firmware must work against both variants; `[core]` commits get cross-checked.

### OPC UA edge connector (was Phase 8, dedicated variant) 🗓

- **What it is:** a Python (`asyncua`) service running **on the client's network**.
- **How it connects:** it maps OPC UA nodes to the device contract and speaks MQTT/TLS outbound only.
- **Actuation:** it writes commands back to OPC UA nodes.
- **Resilience:** it stores and forwards during outages.

Limits:
- Rules stay in the cloud, so it isn't suitable for safety interlocks.
- OPC Classic / DA is out of scope.
- Check first whether the PLC can publish OPC UA PubSub over MQTT itself.

### Anomaly detection / ML (was Phase 9) 🗓

Detectors implement the same pure, synchronous `Evaluator` and run in the worker on the hot path, with models loaded at startup. The likely path is rolling-window and z-score rules, then seasonal baselines, then learned per-device baselines.

### Ideas, not yet scoped

*Add new ideas here as one line each. Promote an idea to its own section above once it has a scope.*

- Connectivity alerts: a "back online" event that resolves the offline alert, plus a per-device mute.
- Reconnect action for offline devices.
- Workspace-wide dashboards.

---

## 4. Non-goals and known limits

- **One host, no high availability.** Recovery is a restore from backup, measured in minutes. Multi-node is out until a deliberate infrastructure-split plan exists (validated to about 1,000 devices).
- **The 2 s guarantee assumes a connected device.** An offline device catches up from its retained desired state when it reconnects, and commands carry a TTL so it never acts on a stale order.
- **Protocols other than MQTT** never enter the platform core; they use the edge-connector pattern.
- **Security 2 provisioning** needs a phone app and an esp32 Arduino core that agree on Espressif's updated message encryption (introduced in ESP-IDF 5.1.7 and the matching 5.x releases; Android app 2.2.3+). Use current versions of both. Security 1 works with every version, and is the safe default.
- **Contact-form rate-limit counters** live in the real Redis, so repeated test runs within an hour can hit the limit.

---

## 5. Where to look next

| Topic | Document |
|---|---|
| Architecture, constraints, conventions | `CLAUDE.md` |
| Frontend standard and its changelog | `docs/design/DESIGN.md` |
| Rule engine model | `docs/rule-engine-multi-device.md`, `docs/phase-3-rules-engine.md` |
| Ingestion and storage | `docs/phase-2-mqtt-ingestion.md` |
| Backend core (auth, tenants, devices) | `docs/phase-1-backend-core.md` |
| BLE provisioning | `docs/ble-provisioning.md` |
| Deploy, VPS, backups | `infra/README.md`, `infra/backups/RESTORE_RUNBOOK.md` |
| Local setup | `README.md` |
