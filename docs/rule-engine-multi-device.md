# Rule engine — Phase 1: multi-device rules

Companion to `PLAN.md`'s rule-engine roadmap (Phase 1). What landed and how to exercise it.

## What changed

A rule is no longer bound to one device.

- **`condition` leaves carry their own `device_id`.** A tree can reference metrics from several
  devices: `Boiler A / temperature > 80 AND Boiler B / pressure > 120`.
- **`actions` is a list.** Each `actuator_command` action carries a `device_id` — it can command
  a device other than the one that triggered the rule.
- **`execution_policy`** replaces the flat `for_duration` / `cooldown` columns:
  `{strategy, for_duration, cooldown, reset_condition}`. `strategy` is `edge` (default —
  re-arm when the tree goes false), `continuous` (re-fire every evaluation, subject to
  `cooldown`), or `reset_condition` (stay disarmed until a separate tree evaluates true).
- **`trigger`** JSONB (`{"type": "metric"}` only for now) and **`name`** / `description` /
  `editor_graph` columns are new.
- **`rule_devices`** records every `(rule, device, role)` pair (`role` = `input` | `target`) —
  **the only device relationship a rule has** (`rules.device_id` is dropped). The hot-path
  cache does not read it — the condition tree is self-describing — but CRUD keeps it in sync
  for referential integrity, the "which rules touch device X" query, the response `devices`
  list, and tenant-scoped validation.

Migration `e7b1c4a92f30_multi_device_rules` backfills every existing rule into the trivial
single-device shape — no rule's behaviour changes. `list_enabled_rules()` is recreated for the
new row type, and `lookup_rule_dispatch_targets(uuid[])` (SECURITY DEFINER) resolves a
non-triggering target device's topic slugs for the worker.

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/rules` | **Canonical** — full multi-device definition (`name`, `condition` with per-leaf `device_id`, `execution_policy`, `actions[]`). Admin. 422 if a referenced device isn't in the tenant. |
| POST | `/devices/{device_id}/rules` | **Backward-compatible wrapper** — omits per-leaf/per-action `device_id` (the path device is stamped), still accepts the pre-multi-device `action` / `for_duration` / `cooldown` fields. |
| GET | `/rules` | Tenant-wide; ordered by name. |
| GET | `/devices/{device_id}/rules` | Rules this device feeds (`input`) or is commanded by (`target`). |
| GET / PATCH / DELETE | `/rules/{id}` | PATCH takes canonical fields, and still honours legacy `action` / `for_duration` / `cooldown`. |

`RuleResponse` has **no `device_id`** — `devices: [{device_id, role, device_name}]` is the sole
device relationship. `condition`, `action` (= `actions[0]`), `for_duration`, `cooldown` stay
present for back-compat alongside `name`, `trigger`, `execution_policy`, `actions`. (There is no
longer a separate `RuleWithDeviceResponse` — `/rules` returns `RuleResponse[]`.)

## Frontend

`RuleForm` gained a **Name** field and a **device picker per condition row** (metrics follow the
chosen device's catalog); the actuator action gained its own **target device** picker. It
submits the canonical `POST /rules` / `PATCH /rules/{id}`. A rule whose condition is a real
nested group (only reachable via the API) is still read-only in the form.

`/rules/new` no longer gates behind a "choose a device" step — the builder is self-contained.
The plain-language summary sits just above the Save button (build top-to-bottom, read it as a
final check). Per-row hysteresis is behind an **Advanced** disclosure on each condition row
(it is genuinely per-predicate). Condition rows carry stable client ids so removing a row
doesn't leak a neighbour's disclosure state.

**Rule identity is the `name`, everywhere.** The `/rules` list shows each rule as its name
(linked) with a muted sub-line of the device(s) it touches (`ESP32-T1 · ESP32-P2 +2`). The
device-detail Rules tab and the "Active rules" overview rail show the **name only**, each row
linking to `/rules/{id}`. A notification's "View Rule" opens that rule directly. The
plain-language sentence (`RuleSummary`) now lives only in the rule editor's live preview;
`ruleSummaryText` was removed.

**Saving a rule refreshes the list immediately.** `RuleForm.onSaved` passes the saved
`RuleResponse` back; `frontend/src/lib/rule-cache.ts::upsertRuleInCache` writes it into SWR's
`/rules` cache via a data-carrying `mutate` (which runs even with no mounted subscriber — a
plain `mutate("/rules")` is a no-op while the editor is open), then `{ revalidate: true }`
refetches once `/rules` remounts. Fixes the stale-list-after-edit bug.

## Verify

```bash
cd backend && uv run pytest && uv run ruff check . && uv run mypy src/app
uv run alembic upgrade head
DATABASE_URL='postgresql+asyncpg://iot:iot_dev_password@127.0.0.1:5432/iot_test' uv run alembic upgrade head
```

Live cross-device hot path (mosquitto against the compose broker):

```bash
#  rule: A.temperature > 80 AND B.pressure > 120  ->  command B.fan1 ON
mosquitto_pub -t "$TS/boiler-b/pressure"    -m '{"value":130}'   # one predicate — no command
mosquitto_pub -t "$TS/boiler-a/temperature" -m '{"value":95}'    # both -> cmd on $TS/boiler-b/cmd/fan1
```

Verified live 2026-09-01: `command dispatched: device=<B> actuator=fan1 latency_ms=7.9`, plus
the retained `state/fan1`.

## Not in this phase

Execution history, rule health / simulate, email delivery, scheduled/manual triggers, richer
operators (BETWEEN / CHANGED / metric-vs-metric), the async retry dispatcher, and the visual
node builder — all later phases in `PLAN.md`.
