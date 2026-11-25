# SCOPE.md: what IO Driven does today

**Last reviewed:** 2026-11-18 · **State described:** production at iodriven.tech, which equals the
`main` branch up to PR #280 (deployed with #282) · **Previous review:** 2026-11-04 (PR #223)

**Since the previous review:** an Android app (§4 *Mobile app*), push notifications, generic
firmware 0.11 → **1.0.0** (self-recovery, sensor recovery, metric decimals and a rate limit,
diagnostics with *device health* alerts, fail-safe outputs, network time, signed over-the-air
updates with rollback), printable device labels, a privacy page, and the **IO Driven** name and
mark everywhere.

This is the single description of what the platform does **today**: what is built, how it works,
what it deliberately leaves out, and what is still open. It is written to stand on its own, so that
someone (or an AI tool) with no access to the code can review it and give a second opinion.

> **Keep it current.** A PR that adds, changes or drops a capability updates this file in the same
> PR, along with the *Last reviewed* line.

**Status marks:** ✅ built and in production · 🚧 built, with a stated gap · ⛔ not built

---

## 0. For reviewers

We want a second opinion in four areas. Section 9 lists specific questions for each.

1. **Scope and gaps.** Is the feature set complete and coherent for the customers in §1? What is
   missing, and what is over-built?
2. **Architecture fit.** Do the stack and design choices (§3) hold for the stated scale and roadmap?
3. **Production readiness.** Security, operations, backups, reliability (§6). What blocks taking
   paying customers?
4. **Product and market.** Positioning, who it is for, what to build next.

**Useful answers:**
- Say which section a point refers to.
- Rank each finding: *blocker*, *important* or *nice to have*.
- Say what you would do instead.
- Where a point depends on an assumption this document doesn't settle (customer type, team size,
  budget), name the assumption.

**Context to weigh everything against:**
- The platform is built and operated by **one developer** (every commit has one author), working
  with an AI coding assistant.
- The design rule is "choose the option one person can operate and debug at 3 am".
- It is live, but **no paying customer is recorded in this document**.

---

## 1. The product

IO Driven is a multi-tenant IoT platform for monitoring and automating physical equipment:

- **Ingest:** devices (ESP32-class boards, or anything that speaks MQTT over TLS) publish sensor
  readings.
- **Decide:** every reading is checked against the workspace's rules **in memory, the moment it
  arrives**.
- **Act:** a firing rule switches actuators (relays, PWM outputs, servos), emails people, posts
  in-app notifications or calls webhooks. A rule can also undo its action when the condition
  clears.
- **Watch and manage:** people follow live dashboards and manage devices, templates, zones, rules
  and members in a browser, on desktop or phone, and follow devices, alerts and controls in an
  Android app with push notifications.

**Key differentiator:** it also covers the device end.

- **Firmware without code:** a ready-made firmware for ESP32-family boards can be installed from
  the browser, configured from a wiring description (which part is on which pin). No code is
  needed. Later versions arrive over the air, signed, with automatic rollback.
- **Wi-Fi from a phone:** the board gets its Wi-Fi credentials from a phone over Bluetooth, from
  the IO Driven app (scan the board's QR) or Espressif's own provisioning app.

So a customer can go from a bare board to a working control loop without writing firmware.

### Who it is for (suggested; to be confirmed by the owner)

The repository does not define target customers. This is inferred from the landing page and the
product:
- the landing page's examples are greenhouse bays, pump houses and tank levels;
- it offers three ways to deploy (cloud, dedicated cloud, on-premise);
- the device side assumes ESP32 boards.

| Segment | Fit | Why |
|---|---|---|
| **Small agriculture: greenhouses, irrigation, livestock buildings** | Strong | Few dozen to a few hundred sensors per site, simple actuators (fans, pumps, valves, heaters), anti-flapping rules matter, little in-house IT. |
| **Facilities and small utilities: pump stations, tanks, water treatment, cold rooms** | Good | Threshold-and-interlock logic, latch-until-reset, offline alerts. |
| **System integrators and makers building small automation for clients** | Good | Templates, no-code firmware, a workspace per client, API keys and webhooks. |
| **Small manufacturing (machine monitoring)** | Partial | Needs Modbus / OPC UA via edge connectors, which are not built (§7). |
| **Large industrial / enterprise** | Weak today | No HA, SSO, audit log, SLA, or certified hardware. |

### Deployment offers (from the landing page)

| Offer | What it is |
|---|---|
| **Cloud** | Hosted, multi-tenant, at iodriven.tech; "updates, backups and monitoring handled for you". |
| **Dedicated cloud** | The customer's own instance: database and MQTT broker not shared. |
| **On-premise** | Runs on the customer's host, for security reviews and compliance needs. |

- **Separate variant:** a single-tenant variant of the platform is maintained separately. It
  shares the **device contract** (§3.4), so devices move between offers without a reflash.
- **Mismatch to note:** the "monitoring" claim on the Cloud offer is not backed by platform
  monitoring today (§6).

---

## 2. Requirements that shape every decision

| Requirement | Target |
|---|---|
| Threshold breach → actuator command | **< 2 s** (typically well under 500 ms on one host) |
| Scale (design point) | **500–1,000 devices** per host |
| Infrastructure | **One Linux VPS** with Docker Compose |
| Roadmap | ML / anomaly detection as a later extension, able to drive actuators |

**The 2 s guarantee assumes a connected device.** No architecture can command an offline device.
A reconnecting device receives its latest desired state immediately (retained MQTT message).
Commands carry a TTL, so a device back after a long outage doesn't act on a stale instruction.

---

## 3. How it is built

### 3.1 Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 + React + Tailwind CSS v4; uPlot for high-frequency charts; SWR |
| Mobile app | Expo + React Native + TypeScript (`expo-router`), Android first; built locally with Gradle |
| Shared client code | `@iodriven/shared` in a pnpm workspace: the generated API types plus pure helpers (status, freshness, formatting, realtime merging) used by both the web and the app |
| Push | Firebase Cloud Messaging (HTTP v1, called directly, no Google SDK), sent from the worker |
| Backend | Python 3.12 + FastAPI (async), Pydantic v2 |
| Hot path / worker | A separate asyncio process using `aiomqtt` |
| ORM / migrations | SQLAlchemy 2.0 (async) + Alembic |
| Database | PostgreSQL + TimescaleDB (relational tables and the telemetry hypertable in one database) |
| MQTT broker | EMQX |
| Cache / stream / pub-sub | Redis |
| Edge | NGINX + Let's Encrypt |
| Runtime | Docker Compose on one VPS |
| Device firmware | C++ on Arduino-ESP32 (pioarduino; ESP-IDF APIs called directly where Arduino falls short), PlatformIO; browser installer over Web Serial; over-the-air updates |

**API types:** the web's and the app's API types are generated from FastAPI's OpenAPI schema,
never written by hand. This is how a Python backend and a TypeScript frontend keep type safety across the seam.

**Why Python, not Node:** the deciding factor is the ML roadmap. An anomaly detector is only useful
if it can trigger actuators. In the same runtime, a detector is just another rule evaluator,
in-process, on the hot path, instead of a separate service that adds a network hop and a failure
mode to a 2 s budget.

### 3.2 The split telemetry path

```
                              ┌──► HOT PATH ─────────────────────────────────────────┐
                              │    Rule evaluation in memory, no database read       │
                              │      fires? → command → EMQX → actuator              │
ESP32 ──MQTT/TLS──► EMQX ──► Ingestion (validates; a bad message is dropped + logged)│
                              │                                                      │
                              └──► STORAGE PATH ─────────────────────────────────────┘
                                   Redis Stream → batched writer → TimescaleDB

  FastAPI (REST + WebSocket) ◄── Redis pub/sub ──  live updates to the browser
```

- **Hot path:** active rules and the latest readings they need are cached in the worker's memory.
  Rule changes invalidate the cache through Redis pub/sub.
- **Firm constraint:** no database round-trip, queue hop or batch flush may sit between a
  message's arrival and its rule evaluation.
- **Storage path:** batching is good for throughput and bad for latency, which is why it isn't on
  the actuation path.
- **Two processes:** the API process and the worker process come from one codebase (a modular
  monolith). The API never subscribes to MQTT; the worker never serves HTTP.
- **Rejected alternatives:**
  - evaluating rules after storage (risks the 2 s budget under load);
  - Kafka (its memory footprint is wrong for one host; Redis is already present);
  - microservices (operationally hostile for one person, and the network hops eat the budget).

### 3.3 Data and multi-tenancy

- **Isolation:** every table carries `tenant_id` and a **Postgres row-level security** policy.
  The app connects as a non-superuser role, so the policies are actually enforced; superusers
  bypass RLS silently.
- **Telemetry exception:** telemetry is a TimescaleDB hypertable `(time, tenant_id, device_id,
  metric, value)`. TimescaleDB compression and RLS can't coexist, so it is isolated by an explicit
  `tenant_id` filter in code instead.
- **Storage discipline** (all enforced in the database):
  - compression after 7 days;
  - 1-minute and 1-hour continuous aggregates, which dashboards query instead of raw rows;
  - a retention policy.
- **Main tables:**
  - **workspace:** tenants, users, memberships, invitations, API keys;
  - **devices:** devices, device templates (catalog), zones, per-sensor health;
  - **rules:** rules, rule versions, rule ↔ device links, rule executions, action executions;
  - **operations:** commands, notifications, dashboards, push devices (one phone token per app
    install per workspace).
- **Credentials:** device tokens and API keys are stored hashed with argon2id.

### 3.4 The device contract (shared with the single-tenant variant; treated as stable)

```
{tenant}/{device}/{metric}            telemetry       device → platform
{tenant}/{device}/cmd/{actuator}      command         platform → device, QoS 1
{tenant}/{device}/state/{actuator}    desired state   retained
{tenant}/{device}/ack/{actuator}      acknowledgement device → platform
{tenant}/{device}/config              publish profile retained, platform → device
{tenant}/{device}/status              health          retained, device → platform; Last-Will target
{tenant}/{device}/ota                 firmware update platform → device, QoS 1, not retained
```

| Message | Payload |
|---|---|
| Telemetry | `{"value": 27.4, "timestamp": 1770001111}` (timestamp optional; server time otherwise) |
| Command | `{"value": true, "issued_at": …, "ttl": 30, "command_id": "uuid"}` |
| Config | `{"metrics": [{"key": "temperature", "publish": "on_change", "interval_seconds": 300, "deadband": 0.2, "decimals": 1}]}` |
| Status | `{"online": true, "rssi": -63, "battery_pct": 87, "uptime_s": 1234, "fw_version": "1.0.0", "reset_reason": "brownout", "boot_count": 7, "heap_free": 118000, "heap_min": 91000, "wifi_reconnects": 2, "faults": […]}` |
| OTA request | `{"version": "1.0.1", "url": "https://…/firmware.bin", "size": …, "sha256": "…", "signature": "…", "command_id": "uuid"}` |

- **Changes since the previous review (all additive and optional, so older firmware keeps
  working):**
  - **`decimals`** per metric: the device rounds to it before sending and before the on-change
    comparison (absent = 3, the old behaviour). Raising it can change when a threshold rule fires.
  - **Status diagnostics** (firmware 0.14.0+): restart reason, boot count, free memory, Wi-Fi
    rejoins and sensors not answering. A Last-Will keeps the last known values.
  - **`ota` topic and progress** (firmware 1.0.0+): the status message reports
    `downloading` / `restarting` / `failed` / `rolled_back`. `ota`, like `status` and `config`,
    is a reserved metric key.
- **Each of these has to be mirrored in the single-tenant variant by hand.** This document doesn't
  record whether that has been done.

- **Credentials and ACLs:** one MQTT credential per device; EMQX ACLs restrict each device to its
  own topic subtree.
- **Other protocols:** OPC UA, Modbus and vendor clouds never enter the platform core. They are
  meant to use an **edge connector** that translates to this contract and looks like a device (§7).

### 3.5 Rules

- **Model:** WHEN / IF / THEN.
  - **WHEN (trigger):** on each reading, on a schedule, manually, or on a device going online or
    offline.
  - **IF (conditions):** across several devices, in nested ALL / ANY groups, with comparison and
    range operators or one metric against another.
  - **THEN (actions):** actuator command, email, in-app notification, webhook.
- **Anti-flapping:** hold time (`for_duration`), hysteresis and cooldown exist to stop relays
  cycling on noisy data. **They can't be bypassed**, because real hardware is on the other end.
- **Execution policy (four strategies):**
  - **edge** (default): fire once per crossing;
  - **continuous:** keep firing while true, spaced by the cooldown;
  - **reset_condition:** stay disarmed until a separate condition is true;
  - **latch:** fire once and stay latched until a person resets it, or until an optional reset
    condition holds (for interlocks).
- **Clear actions:** a rule can run actions once when its condition is *known* false again (for
  example "turn the fan back off").
- **Stale or missing data is *unknown*, never false:** it neither fires, re-arms nor clears.
- **Evaluators** are pure and synchronous, with no I/O, behind one interface:
  `evaluate(rule, reading, state) -> action | None`.
  - Today: one threshold evaluator handles every condition tree.
  - Planned: statistical (rolling window, z-score) and ML detectors as further implementations.

---

## 4. Capability inventory

### Devices and onboarding

| Capability | Status | Notes |
|---|---|---|
| Device registry: create, edit, disable, delete, bulk actions, zones, filters, pagination | ✅ | Status filter: online / offline / never connected / disabled. |
| Per-device MQTT credential (hashed, shown once, rotatable) | ✅ | The Connect flow always creates or rotates it first. |
| Device templates: metrics (number or on/off, unit, decimals, range, publish cadence) and actuators (on/off, number, text, or a fixed list) | ✅ | Usage counts; risky renames are warned about. |
| **Generic firmware**, configured by wiring instead of code, installed from the browser (Web Serial) | ✅ | **1.0.0**, published at iodriven.tech/firmware. The deploy workflow builds and publishes each new firmware version, so the installer no longer lags the source. The board starts its firmware right after a web install, with no replug. |
| Firmware self-recovery | ✅ | Watchdog; MQTT reconnect with backoff; its own Wi-Fi retries, restarting after 5 minutes without Wi-Fi; a wrong Wi-Fi password no longer traps the board; a stuck I²C bus is freed and sensors come back without a power cycle. |
| Publishing discipline | ✅ | Readings follow each metric's Decimals; on change compares rounded values; at most 20 messages/s per device (latest value coalesced, never queued). |
| Fail-safe outputs | ✅ | Per output in the wiring: **Keep** (default) or **Boot state** after 5 s–24 h without the platform. The retained desired state applies again on reconnect. |
| Network time; late commands ignored | ✅ | A command past its TTL isn't acted on. |
| **Over-the-air firmware updates** (Device → Settings → Firmware) | 🚧 | Built: ECDSA P-256 signature, SHA-256 and size checks; the new version is on probation and rolls back unless it reaches the broker within 2 minutes; progress and failures shown and alerted. **Not usable yet:** no public signing key is committed, so the published 1.0.0 is unsigned and boards refuse every update. Boards on 0.x need one USB install of 1.0.0. |
| Supported boards | ✅ | ESP32 DevKit (30- and 38-pin), ESP32-C3 Super Mini, ESP32-S3 DevKitC-1 (two revisions), ESP32-C6 DevKitC-1, Lolin S2 Mini (no Bluetooth). DevKits reset Wi-Fi with the BOOT button (firmware 0.11.1+). Flash use is checked against a 95% guard; the C6 is the tightest at 87.9%. |
| Firmware parts (drivers) | ✅ | **Inputs:** digital in, analog in, DS18B20, DHT22, pulse counter, HC-SR04, MPU6050. **Outputs:** relay, PWM, servo. Plus an I2C bus. |
| Wiring per template, with a per-device override | ✅ | Pin checks per board; parts bring their metrics and actuators, with suggested decimals and deadbands. |
| Device label | ✅ | A printable QR (`/d/<device id>`) opens the device on the web or in the app. It holds no password. |
| Bench test of firmware 0.12–1.0 on real boards | 🚧 | Unit-tested and built for all five chips; the full bench pass is still pending. |
| Generated Arduino sketch for custom firmware | ✅ | For boards or needs the generic firmware doesn't cover. |
| Wi-Fi from a phone: Espressif BLE provisioning, QR carrying the device credential | 🚧 | Security 1 only. Security 2 is in the contract but off until the firmware's provisioning library supports it. Boards without Bluetooth take Wi-Fi typed in at install time. |
| Device health: retained status, Last-Will offline, RSSI, battery, firmware version, uptime; per-sensor staleness | ✅ | |
| Device diagnostics: last restart and why, sensors not answering, memory, Wi-Fi rejoins | ✅ | Health card on the device page. A *device health* alert fires for a restart after a crash, watchdog or brown-out, and for each newly failing sensor; power-ons and reset-button restarts don't alert. |
| HTTP REST ingest as a fallback to MQTT | ✅ | `POST /ingest`. |
| Simulated devices (Add device → *No board yet*) | ✅ | Up to 3 per workspace, from a starter kit. The worker makes up readings every 5 s and acks commands, publishing through EMQX under its own MQTT identity, which may only touch simulated devices' topics; ingestion and rules don't change. Off unless `MQTT_SIMULATOR_PASSWORD` is set (prod). |
| Gateways / edge connectors | 🚧 | Work only as a plain device (§7). |

### Telemetry and storage

| Capability | Status | Notes |
|---|---|---|
| MQTT ingestion with validation; a malformed message is dropped and logged | ✅ | |
| Split hot path / storage path | ✅ | |
| Compression, 1-minute and 1-hour rollups, dashboards read rollups | ✅ | |
| Retention | 🚧 | Fixed **90 days for every workspace**. There are no plans yet, so it isn't per plan. |
| Publish profiles pushed to devices (periodic / on change / streaming) | ✅ | |
| Live browser updates over WebSocket, coalesced for high-rate telemetry | ✅ | Load-tested with a probe; charts append in place. |
| Data export (CSV, API bulk export) | ⛔ | The REST API can read history; there's no export feature. |

### Rules and automation

| Capability | Status | Notes |
|---|---|---|
| Rules as WHEN / IF / THEN, edited as a **Form** or a **Ladder** diagram on one draft | ✅ | Tabs: Basics, When, If, Then, Behaviour (only for rules on readings), Activity. |
| New-rule wizard with recipes (offline alert, threshold switch, schedule, …) | ✅ | |
| Multi-device conditions, nested groups, metric-vs-metric | ✅ | |
| Hold time, hysteresis, cooldown, latch with reset, clear actions | ✅ | |
| Validation: blocking problems vs safety warnings | ✅ | Warnings never block a save. |
| Live preview, "would send" (exact topic and payload), 24-hour replay on rollups, dry run of unsaved edits | ✅ | Replay and dry run send nothing. |
| Rule versions with change lines and Restore; activity history; rule health ("can it evaluate now?") | ✅ | |
| Conflict warning when two rules drive the same actuator | ✅ | |
| ML / anomaly evaluators | ⛔ | The interface exists; no detector is built. |

### Actions, commands and notifications

| Capability | Status | Notes |
|---|---|---|
| Actuator commands: QoS 1, TTL, acknowledgement, retained desired state | ✅ | |
| Controls per actuator | ✅ | A Switch for on/off, a value field with **Set** for numbers (ranged by the wiring), segments for a fixed list. The requested value isn't resent, except through Retry. |
| Command status: Sending, a TTL countdown, Acknowledged, No response with Retry; command timeline | 🚧 | "No response" is worked out in the browser; it isn't stored. Devices don't report their real state yet (a deferred contract change). |
| Email action (SMTP) | ✅ | |
| Webhook action with retries and backoff | 🚧 | POST to any URL. No request signing, and no block on internal or private addresses (§6). |
| In-app notifications | ✅ | Types: device offline, device health, rule fired / cleared, rule health, failed delivery, template changed. Repeats grouped; server-side paging; unread counts by type; read / unread, dismiss / undo. |
| Failed deliveries list with reason and Retry | ✅ | |
| Alarm lifecycle (acknowledge with who and a note, active / cleared state) | ⛔ | The UI is designed; the backend isn't built. |
| "Back online" notification; muting per device | ⛔ | Offline alerts are fixed and on for every device. |
| Push notifications to the Android app | ✅ | Per phone: critical only, or warnings and critical (info never pushes). The payload carries **names only**, never readings or rule text, because FCM relays through Google. A tap opens the device or alert. |
| SMS, Slack / Teams | ⛔ | Webhooks cover integrations for now. |

### Dashboards and landing

| Capability | Status | Notes |
|---|---|---|
| Dashboards shared by the workspace: edit mode, drag / resize, widget sheet, phone list view | ✅ | **Any member can edit any dashboard** until permissions by role are decided (§8). |
| Widgets: value card, trend chart, gauge, device status, actuator control | ✅ | On/off metrics draw as step charts. Stale values are marked stale, never shown as current. |
| A default dashboard per person | ✅ | Sign-in lands on it. The Dashboards link always opens the list. |
| One landing decision after sign-in | ✅ | **Get started** checklist for a new workspace, **Welcome** with a generated starter dashboard for a newcomer, else the default or last dashboard. |
| "Needs attention" strip above every dashboard | ✅ | Unread critical alerts, offline devices, latched rules, rules that can't evaluate. |
| Widget titles | ⛔ | Titles are generated (reading · device). |

### Workspaces, people and access

| Capability | Status | Notes |
|---|---|---|
| Multi-tenant workspaces isolated by RLS; workspace switcher | ✅ | |
| Roles: Owner, Admin, Viewer; owner guards; leave a workspace | ✅ | |
| Invitations by email (7-day link) | ✅ | |
| Sign in with Google (web) | 🚧 | Built: `POST /auth/google` checks the ID token against Google's keys, then signs in by Google id, links the account with that verified email, or makes one (with a workspace, or joining an invitation). Off until `GOOGLE_CLIENT_ID_WEB` is set; the app's button comes with its next release. |
| Sign in, register, forgot / reset password, "Keep me signed in" | 🚧 | 15-minute access token, 30-day refresh token. No email verification on register. No MFA. No rate limit on sign-in (§6). |
| API keys (`Authorization: Bearer`), Viewer or Admin, with expiry | ✅ | |
| Workspace settings: time zone, alert recipients | ✅ | |
| Command palette, responsive shell (icon rail, full sidebar, phone tab bar) | ✅ | Accessibility audited with axe: zero violations across 36+ pages at the last audit. |
| SSO (SAML / OIDC), audit log of who changed what | ⛔ | Rule versions record who edited a rule; nothing else is audited. |

### Mobile app (Android)

| Capability | Status | Notes |
|---|---|---|
| Sign in and stay signed in; workspace switch; the web's header (IO Driven, the workspace, then the page) | ✅ | App **0.6.2**. |
| Devices: list, readings, trends, live updates, status and health | ✅ | |
| Dashboards with the attention strip | ✅ | Read-only: editing stays on the web. |
| Actuator controls on the device and on dashboard widgets | ✅ | |
| Alerts tab with unread count, grouped repeats, paging, read / dismiss / undo | ✅ | Same actions as the web. |
| Rules: turn on / off, Reset latch | ✅ | Creating and editing rules stays on the web. |
| **Scan** (top bar, every screen): a device label opens the device; a board's setup QR starts **Set up Wi-Fi** over Bluetooth | ✅ | Wi-Fi setup searches fresh, never hangs, says why it failed and when the board has the Wi-Fi. |
| Push notifications | ✅ | See *Actions, commands and notifications*. |
| Update gate | ✅ | The app checks `/meta/client` at start; a version below the minimum shows only *Update required*. A failed check never blocks. |
| Distribution | 🚧 | APKs published as GitHub pre-releases. The Play internal-testing setup is prepared (`docs/mobile-release.md`, store images, data-safety answers); the Play Console steps are the owner's. App Links verify only with a Play- or upload-signed build. |
| iOS | ⛔ | The code is iOS-ready; no iOS build or listing. |

### Public site

| Capability | Status | Notes |
|---|---|---|
| Landing page: product tour, how it works, safety, onboarding, security, deployment options, FAQ | ✅ | |
| "Talk to us" contact form | ✅ | Emails the owner and stores nothing; honeypot, 5 per address per hour. |
| Privacy page (`/privacy`), linked from the landing and sign-in footers | 🚧 | Written from what the platform actually does (for example: backups are not encrypted). A factual draft, not reviewed by a lawyer. |

### Business

| Capability | Status | Notes |
|---|---|---|
| Billing, plans, quotas, usage metering | ⛔ | |
| Public demo workspace | ⛔ | Simulated devices (§4 *Devices and onboarding*) let any workspace try the platform without hardware. |

---

## 5. Quality and size

| Item | Value |
|---|---|
| Backend | About 14,300 lines of Python; 527 pytest tests (unit tests for the evaluators, integration tests against real RLS policies, including a cross-tenant read test) |
| Web | About 34,400 lines of TypeScript (less than at the last review, because shared code moved out); 205 vitest unit tests; 75 Playwright end-to-end tests in 34 specs |
| Shared client package | About 9,300 lines of TypeScript, mostly the generated API types; 97 vitest tests |
| Mobile app | About 5,500 lines of TypeScript; 48 jest tests. One run during this review had 3 failures that passed on rerun (flaky under load) |
| Firmware | About 3,400 lines of C++, plus board and driver catalogs as data; native unit tests for publishing math, command math, driver math, the config blob and LED patterns |
| Type checks | `mypy --strict` on the backend, `tsc` on the web, shared package and app; ruff and ESLint |
| CI | 🚧 **Firmware only.** The deploy workflow builds, signs (once a key exists) and publishes firmware releases for all five chips. No test suite runs in CI; every suite runs locally before merge. |
| Design system | One binding design document (`docs/design/DESIGN.md`) with a changelog, followed by every UI change |

---

## 6. Production readiness

### In place

- **Deploy:** push-to-deploy from a `prod` branch with GitHub Actions, migrations on deploy, and a
  health check. The same workflow builds and publishes new firmware releases.
- **Firmware signing:** the private OTA signing key is meant to live only as a secret of the
  protected `production` GitHub environment plus an offline backup, never on the VPS. Releases are
  refused unsigned once a public key is committed. The key isn't created yet (§4).
- **Push:** the FCM service-account key is a host file mounted read-only into the worker; push is
  off if it isn't set.
- **TLS:** Let's Encrypt on NGINX with a renewal timer. Devices connect over MQTT/TLS.
- **Backups:** a daily database backup at 03:00, with a restore script and runbook. The off-host
  copy is optional (`RCLONE_REMOTE`).
- **Admin scripts:**
  - wipe a whole environment (local or production);
  - delete one tenant's operational data (telemetry, notifications, rule activity, commands,
    device status), keeping its configuration.
- **Isolation:** RLS on every table except telemetry, with an explicit filter there. The app runs
  as a non-superuser role.
- **Credentials:** hashed with argon2id. Secrets live only in environment variables.

### Known gaps, in our own order of concern

| Gap | Risk |
|---|---|
| **No monitoring or alerting** (uptime, worker liveness, ingestion lag, disk, certificate expiry) | A stopped worker means no rules run and no one is told. The Cloud offer promises monitoring. |
| **Restore drill not recorded** | The runbook exists, but no tested restore is on record. Our own rule says an untested backup isn't a backup. |
| **Off-host backup copy is optional** | A lost VPS loses its backups too, unless `RCLONE_REMOTE` is set. |
| **Webhook URLs are not restricted** | An Admin can point a webhook at internal services (server-side request forgery). There's no signature for receivers to verify. |
| **No sign-in rate limit, no MFA, no email verification** | Credential stuffing; workspaces created with unowned email addresses. |
| **No test CI** | Regressions rely on running suites locally before merge (CI builds firmware only). |
| **One host, no high availability** | Recovery is a restore from backup, measured in minutes to hours. |
| **OTA signing key not set up** | Over-the-air updates are built but refused by every board, so a firmware fix still means reconnecting each board over USB. |
| **Firmware 0.12–1.0 not bench-tested as a whole** | Recovery, fail-safe and rollback behaviour is proven by unit tests and builds, not yet on real hardware end to end. |
| **Backups are not encrypted** | Stated on the privacy page; matters more once the off-host copy is used. |
| **Privacy page not legally reviewed** | Needed before the Play listing goes public and before paying customers. |

---

## 7. Not included, and known limits

- **One host.** Multi-node and high availability are out until a deliberate infrastructure-split
  plan exists. The design is validated to about 1,000 devices.
- **Other protocols.** Protocols other than MQTT never enter the core; they use the edge-connector
  pattern.
- **Gateways work only as a plain device.** A gateway can use a *Custom firmware* template: it
  connects with one device credential and speaks the contract. Missing for real gateway support:
  - **a Connect path for gateways:** the flow assumes a board;
  - **child devices under one gateway credential:** today the ACL limits a credential to its own
    subtree, so ten PLCs behind one gateway become one device or ten credentials;
  - **our own connector agent** (for example on a Raspberry Pi) hosting Modbus and OPC UA.
- **Devices don't report actuator state** (applied or not). Deferred by decision on 2026-10-20,
  because it is a contract change for both deployment variants and the firmware.
- **Deployment variants.** The single-tenant deployment variant is kept in sync with this one
  **by hand** for the device contract.
- **Not built:**
  - billing and plans;
  - monitoring;
  - CSV export;
  - alarm lifecycle;
  - SSO and audit log;
  - non-MQTT connectors;
  - ML / anomaly detection;
  - test CI;
  - an iOS build of the app;
  - creating or editing rules and dashboards in the app (web only, by design for now).

---

## 8. Open decisions

| Decision | Current state |
|---|---|
| Dashboard permissions by role | Any member, Viewers included, can edit any dashboard. Who should be able to edit is undecided. |
| Plans and pricing | No plans exist. The original design assumed a free tier (7-day retention) and a paid tier (90 days). |
| Gateway support | Scope known (§7); not scheduled. |
| Reported actuator state | Deferred (§7). |
| Alarm lifecycle | Designed in the UI standard, backend not started. |
| Who the customers are | §1 is a suggestion, not a decision. |
| Rolling out OTA | Needs the signing key (owner's one-time setup in `docs/firmware/ota.md`), then one USB install of 1.0.0 per board. |
| Play Store release | Internal testing prepared; public listing waits on the owner's Play Console setup and the privacy review. |

---

## 9. Questions for reviewers

**Scope and gaps**
1. For the segments in §1, which missing capabilities in §4 and §7 would block a first sale?
   Which built ones are more than such a customer needs?
2. Is building our own firmware and browser installer a strength worth its maintenance cost, or
   should the platform stay hardware-agnostic and leave firmware to customers?
3. What should come next, in order: alarm lifecycle, monitoring, gateway / Modbus support,
   billing, or ML detection?
4. Is an Android app with view, control and alerts (rules and dashboards edited only on the web)
   the right split, and does it need iOS before a first sale?

**Architecture fit**
5. Is one VPS (with backups and no HA) acceptable for automation that switches real equipment? If
   not, what is the smallest step up that one person can operate?
6. Is the split hot path / storage path sound? Are there failure modes (worker crash, Redis loss,
   EMQX restart) that lose commands or fire rules wrongly?
7. Telemetry has no RLS because of compression. Is an explicit `tenant_id` filter in code an
   acceptable risk, and how would you guard it?
8. Does Python + FastAPI + one asyncio worker hold at 1,000 devices, and at what point would you
   split?

**Production readiness**
9. What are the minimum monitoring and alerting a single operator needs, and with which tools?
10. Which security gaps in §6 must be closed before taking paying customers?
11. Would you sell the Cloud offer before a restore drill is recorded and off-host backups are
    mandatory?

**Product and market**
12. Who would you target first, and how would you position against existing platforms
    (ThingsBoard, Blynk, Ubidots, Losant, AWS IoT, Arduino Cloud)?
13. Are the three deployment offers (cloud, dedicated, on-premise) right for one developer to
    support, or should some wait?

---

## 10. Where to look in the repository

| Topic | Document |
|---|---|
| Architecture, constraints, conventions | `CLAUDE.md` |
| Frontend standard and its changelog | `docs/design/DESIGN.md` |
| Rule semantics | `docs/rule-engine-multi-device.md` |
| Implementation decisions and the runtime diagram | `docs/decisions.md` |
| Generic firmware, OTA updates and signing | `firmware/README.md`, `docs/firmware/` (`ota.md`) |
| Mobile app, push, Play release | `mobile/README.md`, `docs/mobile-push.md`, `docs/mobile-release.md` |
| BLE provisioning | `docs/ble-provisioning.md` |
| Deploy, VPS, backups | `infra/README.md`, `infra/backups/RESTORE_RUNBOOK.md` |
| API reference | the running API's OpenAPI docs at `/docs` |
| Local setup | `README.md` |
