# SCOPE.md: what iodriven does today

**Last reviewed:** 2026-10-07 · **Version:** 1.0 (in production at iodriven.tech) · **Up to:** PR #86

The single list of what the platform does **today**: what is built and what it deliberately leaves out. Plans and ideas live elsewhere (the original plan is archived in `docs/history/PLAN.md`).

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

**Status:** ✅ built · 🚧 built, with a stated gap

---

## 2. Capability inventory

### Devices and onboarding

| Capability | Status | Notes |
|---|---|---|
| Device registry: create, edit (Settings tab), disable, delete, bulk actions | ✅ | List with online / offline / never connected / disabled KPIs, filters, peek drawer. |
| Per-device MQTT credential, stored hashed (argon2id), shown once, rotatable | ✅ | EMQX ACLs restrict each device to its own topic subtree. |
| Device templates: metrics (number or on/off, unit, decimals, range, publish cadence) and actuators | ✅ | Keys validated as topic segments; usage counts; a rename that would break rules or widgets is warned about. |
| Generated firmware sketch (ESP32 and ESP32-C3) with topics, TLS and credential filled in | ✅ | Pins common to the 30- and 38-pin DevKits; provisioning reset on GPIO 19 (C3: GPIO 9). |
| Wi-Fi from a phone: Espressif BLE provisioning (ESP BLE Prov app), QR from the device credential, Security 1 or 2 | ✅ | `docs/ble-provisioning.md`. Security 2 needs a matching phone app and esp32 board package (see §3). |
| 5-step connect flow with a live "waiting for first message" check and a test command | ✅ | |
| Zones (places devices live in), filter devices by zone | ✅ | A zone can't be deleted while devices are in it. |
| Device health: retained status topic, Last-Will offline, RSSI / battery / firmware / uptime | ✅ | |
| "Device went offline" notification | 🚧 | Fixed and on for every device; no "back online", can't be muted per device. |
| HTTP REST ingest as a fallback to MQTT | ✅ | `POST /ingest`. |

### Telemetry and storage

| Capability | Status | Notes |
|---|---|---|
| MQTT ingestion with validation; a malformed message is dropped and logged, never stops the stream | ✅ | `docs/phase-2-mqtt-ingestion.md`. |
| Split path: rules on the in-memory hot path; Redis Stream → batched writer → TimescaleDB for history | ✅ | |
| Compression after 7 days; 1-minute and 1-hour continuous aggregates; dashboards read rollups | ✅ | |
| Retention | 🚧 | Fixed **90 days for every workspace**. There are no plans or quotas yet, so retention is not per plan. |
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

### Operations

| Capability | Status | Notes |
|---|---|---|
| Push-to-deploy to the VPS (GitHub Actions, `prod` branch), migrations on deploy, health check | ✅ | `.github/workflows/deploy-prod.yml`, `infra/README.md`. |
| TLS via Let's Encrypt with a renewal timer | ✅ | |
| Daily database backup (03:00) and a restore script with runbook | 🚧 | `infra/backups/`. Off-host copy is optional (`RCLONE_REMOTE`); **a restore drill has not been recorded yet** (CLAUDE.md §9.13). |
| Tests | ✅ | Run locally: backend `pytest` (unit + integration against real RLS), frontend vitest and Playwright. |

---

## 3. Not included, and known limits

- **One host, no high availability.** Recovery is a restore from backup, measured in minutes. Multi-node is out until a deliberate infrastructure-split plan exists (validated to about 1,000 devices).
- **The 2 s guarantee assumes a connected device.** An offline device catches up from its retained desired state when it reconnects, and commands carry a TTL so it never acts on a stale order.
- **Protocols other than MQTT** never enter the platform core; they use the edge-connector pattern.
- **Security 2 provisioning** needs a phone app and an esp32 Arduino core that agree on Espressif's updated message encryption (introduced in ESP-IDF 5.1.7 and the matching 5.x releases; Android app 2.2.3+). Use current versions of both. Security 1 works with every version, and is the safe default.
- **Not built:** billing, plan tiers and quotas; monitoring and alerting; rate limiting outside the contact form; automated test CI; a public demo workspace; workspace-shared dashboards and CSV export; non-MQTT protocol connectors; ML / anomaly detection.
- **Contact-form rate-limit counters** live in the real Redis, so repeated test runs within an hour can hit the limit.

---

## 4. Where to look next

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
