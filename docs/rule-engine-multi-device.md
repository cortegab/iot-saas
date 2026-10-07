# Rule engine — Phase 1: multi-device rules

Companion to `docs/history/PLAN.md`'s rule-engine roadmap (Phase 1). What landed and how to exercise it.

> This doc is authoritative for rule **semantics** (tree, latch, `clear_actions`, stale = unknown).
> How the rule editor **presents** them is defined in `docs/design/DESIGN.md` §9.

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
node builder — all later phases in `docs/history/PLAN.md`.

## Later addition: on-clear actions

A rule can undo what it did. `clear_actions` (same shape as `actions`) run **once** when a
fired rule's condition is known to be false again — e.g. a switch on device A turns an LED on
device B on, and releasing the switch turns it off. Before this, that took a second,
independent rule (`switch == 0 → LED off`), which could drift out of sync with the first.

- **When it clears.** An inequality clears at its hysteresis release point, not the bare
  threshold: `temperature > 30`, hysteresis 2 → the fan turns on above 30 and off at 28 or
  below (a thermostat band from one rule). `==` / `!=` and the Phase 6 operators clear as soon
  as they're false. An AND clears when any leaf releases; an OR when all of them have.
- **`execution_policy.clear_for_duration`** (default 0): how long the condition must stay
  cleared first — staircase-light behaviour ("off 10s after release"), and a debounce for a
  bouncy switch (a boolean `==` leaf has no hysteresis). The worker's `pending_timer_loop`
  (1s) completes this delay even when no further reading arrives, and likewise completes a
  `for_duration` hold for an `on_change` metric.
- **Stale or offline data holds the last state.** A signal that stops reporting never
  triggers a clear — "unknown" is not "released". The rule's can't-evaluate badge and
  notification (Phase 5) report the outage instead. As with every command, a device that is
  offline when the clear fires catches up from the retained `state/{actuator}` topic on
  reconnect.
- **Cooldown never delays a clear** (a relay must not be left on), and a clear only ever
  follows a firing, so relay cycling stays bounded by `for_duration`, `cooldown`, and
  hysteresis. The rule form warns when an actuator clear has neither hysteresis nor a delay.
- **Metric triggers only.** Schedule, manual, and `device_status` rules reject `clear_actions`;
  "Run now" never clears.
- **Audit.** Each clear is a `rule_executions` row with `edge = 'clear'` ("Cleared" in the
  Activity tab). It only writes a platform notification if its clear actions include one.

The device contract (CLAUDE.md §4) is unchanged — a clear is an ordinary command on the same
`cmd` / `state` topics.

## Later addition: simplified model — latch, event triggers, email action

The rule editors present every rule as **WHEN → IF → THEN** (see the Form / Ladder editors).
Engine changes behind that vocabulary:

- **Event triggers fire on every event.** `schedule` and `device_status` rules are evaluated
  by `ThresholdEvaluator.evaluate_event`: fire iff the condition holds now (or there is none),
  subject to `cooldown`; leaf hysteresis still latches across events. Previously they went
  through the edge gate, so a condition-less rule — or one whose condition stayed true between
  ticks — fired once and never re-armed. `for_duration` does not apply to event triggers (an
  event has no duration to hold across) and is ignored for them.
- **`condition` is optional for schedule / manual / device_status** — "every morning at 8, turn
  the pump on". Required only for metric (on-reading) triggers. With no condition and no
  actuator action, the run has no triggering device (`rule_executions.device_id` is null).
- **`execution_policy.strategy = "latch"`** (metric triggers only, no `clear_actions`): fire
  once, then stay latched until `POST /rules/{id}/reset` (admin) or, if set, `reset_condition`
  evaluates true. The tree going false never re-arms it. A reset while the condition is still
  true re-latches only after a fresh `for_duration` hold. The worker keeps the latched set in
  Redis (`rules:latched`) for `RuleResponse.latched`, and publishes a realtime `rule_latched`
  event on each change.
- **`email` action** `{type, to[], subject, body}` — `to` empty falls back to the tenant alert
  list (same as a notification's email channel, which stays supported). Delivered by the
  deferred executor with retry, like webhooks.

No migration: strategy and actions are JSONB, and `action_executions.action_type` already
allowed `email`.
