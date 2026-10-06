# DESIGN.md — frontend design directives

The single source of truth for how the iot-saas frontend looks, is laid out, behaves and is worded.
It turns the approved **demo G** (`docs/design/redesign/demo-g-full-site.html`) into rules for the
real Next.js app. Read it before building or changing any page or component.

---

## 1. Purpose, status and precedence

**Precedence, highest first:**

1. **`CLAUDE.md` §9 constraints always win.** These cover safety, the 2 s hot path, generated API
   types, RLS and hashed credentials. Nothing here overrides them. For example, flapping controls
   can never be hidden.
2. **This file** is authoritative for frontend look, layout, components, interaction and wording.
3. **Demo G** is the visual reference where this file is silent. When you settle a gap by looking at
   the demo, write the answer back into this file.
4. **Everything else is subordinate**, and gets updated to match this file, never the reverse:
   - code comments (for example the "Control Room" comments in `globals.css`)
   - demos A–F
   - UI bullets in `PLAN.md`
   - suggestions from the `frontend-design` / `ui-ux-pro-max` skills
   - older notes

**Status:**
- Demo G is a prototype. Its **behaviour, layout and wording are binding**. Its vanilla-JS code is
  not: build it with the app's React primitives.
- Demos A–F are kept for history only.
- **Rule semantics are defined elsewhere.** `docs/rule-engine-multi-device.md` and CLAUDE.md §5 own
  the condition tree, latch, `clear_actions` and "stale = unknown". This file owns only how the
  rule editor presents them.

**Changing a directive:** edit this file first and add a changelog entry (§15), then change the code.
One-off styles, palettes or component variants are not allowed (CLAUDE.md §9.14).

---

## 2. Principles

| Principle | What it means in practice |
|---|---|
| **One pattern per job** | Every list is the same list and every editor is the same editor. If two screens solve the same problem differently, one of them is wrong. |
| **Show consequences before saving** | Editors state what saving will do: a consequence line, "Would send", a replay, blocked-delete reasons. |
| **Plain language over syntax** | No cron, regex or JSON as the default input. Syntax is an explicit "Custom" escape hatch for experts. |
| **Safety is visible, never bypassable** | Hold time, hysteresis and cooldown are always shown, and their errors appear while you type. |
| **Every state is designed** | Each view has designed loading, empty, no-results, error, stale-data and read-only states. None is a blank area or an endless skeleton. |
| **Keyboard- and phone-usable** | Every flow works with a keyboard alone, and at 390 px wide with no horizontal scroll. |

---

## 3. Tokens

Tokens live in `frontend/src/app/globals.css`, exposed to Tailwind v4 via `@theme`. The **names are
unchanged** from the current file; only the values change. **Never hard-code a colour, radius or
font in a component.** If you need a value that has no token, add the token here first.

### Theme

- **Light is the default.** It follows `prefers-color-scheme`, and the user can override it with the
  theme toggle; the override is persisted.
- Dark is a full peer, not an afterthought. It is applied by the `.dark` class on `<html>`.
- This inverts the current "dark first" setup. Update the no-flash script in `app/layout.tsx` and the
  `@custom-variant dark` selector to match.

### Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-canvas` | `#f7f7f8` | `#0f1014` | page background |
| `--color-surface` | `#ffffff` | `#16171c` | cards, tables, panels |
| `--color-surface-raised` | `#f2f2f5` | `#1e2027` | secondary buttons, hover, summary boxes |
| `--color-border` | `#e3e3e8` | `#2a2c34` | all 1 px borders |
| `--color-border-soft` | `#eeeef2` | `#222329` | row dividers |
| `--color-ink` | `#15161a` | `#ececf1` | text |
| `--color-ink-muted` | `#62646f` | `#9a9ca8` | labels, hints, meta |
| `--color-accent` | `#4f46e5` | `#818cf8` | primary buttons, links, focus, active nav/tab, selected state |
| `--color-accent-strong` | `#4338ca` | `#a5b4fc` | hover/pressed, accent text on muted fill |
| `--color-accent-muted` | `#eef0ff` | `#1f2040` | selected fill, info callouts, sentence box |
| `--color-on-accent` | `#ffffff` | `#0f1014` | text on accent fill |
| `--color-chart` | `#0e7490` | `#22d3ee` | **data only**: trend lines, readouts, sparklines, replay strips |
| `--color-chart-grid` | `rgba(20,20,40,.07)` | `rgba(255,255,255,.07)` | chart gridlines |
| `--color-status-online` | `#15803d` | `#4ade80` | online, armed, checks passed |
| `--color-status-offline` | `#dc2626` | `#f87171` | offline, alert count badge |
| `--color-status-pending` | `#b45309` | `#fbbf24` | pending, never connected, latched, warnings |
| `--color-status-unknown` | `#6b7280` | `#9ca3af` | unknown, disabled, stale |
| `--color-status-error` | `#dc2626` | `#f87171` | validation errors, danger buttons |
| `--color-status-error-surface` | `#fef2f2` | `#2a1517` | error callout fill |
| `--color-status-pending-surface` | `#fffbeb` | `#2a2211` | warning callout / `tag--warn` fill |
| `--color-pop` | `#ffffff` | `#1a1b21` | popovers, menus, dialogs |
| `--color-scrim` | `rgba(17,17,30,.3)` | `rgba(0,0,0,.58)` | behind drawers and dialogs |
| `--color-sidebar` | `#fbfbfc` | `#121318` | sidebar |
| `--color-row-hover` | `#f8f8fb` | `#1a1b21` | table row hover |
| `--color-input` | `#ffffff` | `#121318` | input fill |

**Two accent roles, kept apart:**
- `--color-accent` (indigo) is for UI chrome only.
- `--color-chart` (cyan) is for data only, and is never used as a button or background.

**Status is never shown by colour alone.** Always pair it with a dot or shape and a word.
`--color-panel-edge` (the Control Room card highlight) is retired.

### Shape, type and elevation

| Token | Value |
|---|---|
| Radius (Tailwind scale) | `rounded-md` 8 px (controls) · `rounded-xl` 12 px (cards, tables, panels) · `rounded-2xl` 16 px (large surfaces, dialogs). `rounded-sm` 6 px and `rounded-lg` 10 px are for small inner parts only. |
| `--h-control` | 36 px: every button, input, select and segmented control (`h-control` utility). Minimum touch target is 36 px. |
| `--pad-cell` | 12 px table cell padding (`p-cell` utility) |
| `--fs-base` / `--fs-sm` / `--fs-xs` | 14.5 / 14 / 12.5 px |
| `--shadow-card` | `0 1px 2px rgba(30,30,60,.05)` light; `none` dark |
| `--shadow-pop` | `0 24px 48px -16px rgba(30,30,60,.22), 0 2px 6px rgba(30,30,60,.08)` light; `0 24px 48px -16px rgba(0,0,0,.7), 0 2px 6px rgba(0,0,0,.4)` dark |
| Fonts | **Geist** (display, sans, readouts) and **Geist Mono** (keys, topics, payloads, times in chips), loaded via `next/font`. Replaces Chivo / IBM Plex. |

- Page titles are 28–30 px, weight 600, letter-spacing −0.015em.
- Section headings are 15–16 px, weight 600.
- Numbers use `tabular-nums`.

### Status vocabulary

| Entity | States (word + tone + dot) |
|---|---|
| Device | Online (online) · Offline (offline) · Never connected (pending) · Disabled (unknown) |
| Rule | Armed (online) · Fired (accent) · Latched (pending, square dot) · Disabled (unknown) |
| Data freshness | Live · Stale (unknown, `.is-stale` 60 % opacity) · No data |

---

## 4. App shell

- **Sidebar** is 256 px wide and sticky. From top to bottom:
  - The workspace switcher (logo tile, name, "role · N devices").
  - The **⌘K search / command palette** trigger. The palette is both navigation and actions:
    "New rule", "Go to device…".
  - Grouped nav:

    | Group | Items |
    |---|---|
    | **Monitor** | Dashboards, Devices, Notifications |
    | **Automate** | Rules |
    | **Configure** | Device templates, Zones |
    | **Admin** | Members, API keys, Workspace settings |

    Each item has an icon, a label and a right-aligned count. Notifications uses a red alert count
    badge instead.
  - The **footer**: user avatar and name, a live-connection indicator ("Live updates on"), and the
    theme toggle.
- The logo links to Dashboards, which is the first nav item.
- **Page header**: breadcrumbs, an overline and status pill where relevant, an H1, a one-line
  description, a meta row, and actions on the right. The primary action is rightmost.
- **Content column**: max 1120 px, and 1520 px for wide views (dashboards, the rule workbench). A
  list never changes width: its peek opens as a drawer over it.
  Padding is 36 px top, 40 px sides and 110 px bottom so the save bar never covers content.
- **Below 1100 px** the sidebar becomes a drawer behind a menu button.

---

## 5. Components

Build every screen from these. **Existing** means the file is in `frontend/src/components/ui/` and
gets restyled to the tokens. **NEW** means it has to be created.

| Component | Status | Directives |
|---|---|---|
| Button | existing | Variants: `primary` · `secondary` · `ghost` · `danger` (filled, NEW variant) · size `sm`. One primary per view. Labels are verbs ("Save rule", "Add device"). |
| Field | existing | Label above, control, one message line below. That line holds the hint, or the error/warning replacing it (`aria-describedby`). Errors show on blur or submit; **safety errors show while typing**. Optional fields say "optional" in the label. |
| Input / Select / Textarea | existing | 36 px, `--color-input` fill, mono for keys/topics. Affix (suffix unit such as `s`, `°C`) inside the control. |
| Combobox | existing | For long lists with search (units, devices). |
| SegmentedControl | existing | Mutually exclusive modes (Form / Ladder, schedule repeat mode). `role="radiogroup"` or pressed buttons. |
| **Switch** | NEW | Every on/off **setting that is saved with a record** (`SwitchField`): a label naming the setting above, the switch beside a **state word**, and a hint below that changes with it. State words: **Enabled / Disabled** for a record's own status (label "Status": rule, device, template), **On / Off** for an option inside a record (e.g. "Turn it back when the condition clears", "Send a notification when it clears"). A **checkbox** is only for picking items in a list (bulk select) or for a one-time choice that belongs to a single submit and isn't stored as a setting ("I've stored it", "Keep me signed in on this device"). List row menus use the verbs **Enable / Disable**. |
| Tabs | existing | Underline style. **Never show a horizontal scrollbar**: overflowing tabs wrap or collapse into a menu. |
| Badge / Tag | existing | Pills with a status dot. `tag--warn` (pending surface) for conflicts ("shares fan1"). `tag--sm` for qualifiers ("expert"). |
| Callout | existing | `info` (accent-muted), `warning` (pending surface), `error` (error surface). Dismissible for tips only. |
| **Toast** | NEW | Bottom-right, stacked. Title plus a detail line; save toasts carry the **change summary** ("2 changes: Schedule: … → …"). |
| ConfirmDialog | existing | For destructive actions and guards. Title states the action; the body states the consequence with real numbers; the danger button repeats the verb. |
| **Sheet / Drawer** | NEW | The record peek at every width (560 px, full height); mobile nav. Scrim + focus trap + Esc. |
| **CopyField / SecretReveal** | NEW | One component for every one-time secret (device token, API key). It replaces the four copies in the devices and tokens pages. Shown once, with a copy button and a "won't be shown again" warning. |
| EmptyState / ErrorState / LoadingSkeleton | existing | Every list and panel has all three. Empty explains why and offers the primary action. Error and empty never render together. |
| Table | existing | See §6. |
| **KPI strip** | NEW | 3–4 figures in one bordered strip above a list (e.g. online / offline / never connected). |
| **Mini strip / sparkline** | NEW | 48-cell 24 h strip (true / unknown-hatched / fired) for rules. Sparkline for readings. Uses `--color-chart`, with accent for fire marks. |
| Readout / Metric | existing | Live values in Geist, tabular-nums, unit in muted. Stale values dim. A metric is named by its template **name** everywhere (readouts, chart pickers, legends, widget titles), with its wire key only when undeclared. Every surface formats a value the same way (`formatReading`): an on/off metric reads **On / Off** (capitalised, no unit), a number uses the template's decimals. |
| **Trend chart** | existing | One component for the device page and the dashboard widget. A number is a line, with dashed rule thresholds. An **on/off metric** is a **step line** on an **Off / On** axis with a light wash under On, and has no threshold line. Once aggregated it stays on Off / On: a minute or hour shows On if the metric was On at any point in it. The state is carried forward only from a bucket that held one state, otherwise the line breaks until the next reading. Never ramps, never a "% of readings". Gauges take numbers only. |

---

## 6. List pages: the catalog standard

**Every catalog list uses the same anatomy, in this order:**

1. Page header (§4) with the primary "New …" action.
2. KPI strip, only where the counts drive action (Devices, Rules).
3. **Toolbar**:
   - search
   - filter menus
   - **active-filter chips** with a "Clear" action
   - result count ("12 of 15")
4. **Table**:
   - Sortable columns (the header shows the sort direction).
   - A name cell with a secondary line.
   - Status pill, right-aligned numbers, and a row actions menu (⋯).
   - Bulk-select checkbox column where bulk actions exist.
   - Hover highlight; clicking a row opens its **read-only peek** in a drawer over the list (§7).
     The name is a link to the record's page. Enter on a focused row peeks it; Enter again opens the
     page.
5. **Table footer**: pagination and page size.
6. States: loading skeleton rows · empty (first-use) · no results (with "Clear filters") · error with a retry.

| List | Columns |
|---|---|
| Devices | Device · Template · Zone · Status · Last seen |
| Device templates | Template · Metrics · Actuators · Devices · Status |
| Zones | **Zone · Devices · Status** (no Rules column) |
| Rules | Rule (+ 24 h mini strip, "fired N× in 24 h", "shares X" tag) · Trigger · Action · State |
| Dashboards | Dashboard · Widgets · Updated |
| Members / API keys | Name · Role/Scope · Last active · actions |

Below 640 px, tables collapse to stacked cards with the same fields.

---

## 7. Editors: one editing model

Every create/edit flow, whether catalog record, rule or settings, uses **the same editor chrome** in
three presentations.

| Presentation | When |
|---|---|
| **Peek**: a drawer over the list, at every width | **Looking only.** Key facts, status, the next step (Edit / Open) and a ⋯ menu. No fields, no save bar. `?peek=<id>`. The drawer blocks the list, so browsing happens inside it: ‹ › with "n of N", and ↑/↓ while focus is in the drawer. Closing returns focus to the row last shown. |
| **Full page** | **Every create and edit**, for every record: `/x/new`, `/x/{id}` (a device: its page's Settings tab). Deep-linkable. |

One place to look and one place to change each record; "New" goes where "Edit" goes. There is no
editable side panel and no "Expand" toggle.

**Shared chrome (all three presentations):**
- A title ("Edit rule", "New device template") and a record menu (⋯: Duplicate, Delete).
- A **section rail** in page mode. It lists the sections and shows a per-section error badge. Clicking
  a section scrolls to it. "Expand all" is available.
- A **consequence line** under the title that says what saving does ("Saving applies within a
  second. It watches 1 device and can switch 1 actuator").
- A **sticky save bar** that shows "Unsaved changes" or "All changes saved", with **Discard** and
  **Save**. Save is disabled while there are no changes, and focuses the first error when invalid.
- An **unsaved-changes guard** on close, navigate and reload.
- **Post-save toast** with the change summary. The editor stays on the record after saving; it
  doesn't redirect somewhere else.
- **Delete blocked** with an explanation and links when the record is in use ("3 devices use this
  template"). A delete that is allowed confirms with the real consequence.
- **One record menu, three places.** The list row ⋯, the peek ⋯ and the page ⋯ offer the same
  actions with the same words. Menu items name only the action, because the record is implied:
  **View devices**, **Duplicate**, **Enable / Disable**, **Delete…**. An ellipsis means a dialog or
  confirm follows. **Delete…** is last, on its own, in the danger style. While the record is in use
  it is still offered, with the usage count as its hint ("2 devices are in it"), and picking it
  explains the block. A standalone button outside a menu (the device Settings danger zone) keeps
  the noun: "Delete device…".
- **Rename warnings** when a key is referenced ("`temperature` is used by 3 rules and 2 widgets").
- Read-only mode for roles without edit rights shows a banner, disabled controls and no save bar.
- **Deep links:** every record and every editor state has a URL (list, list + peek, full page,
  section). The page's breadcrumb returns to the list with that record peeked.

---

## 8. Catalog-specific rules

- **Device templates**
  - Key slug generated live from the name, with a lock icon once the key is used.
  - Reserved keys (`status`, `config`) and duplicates are rejected inline (CLAUDE.md §4).
  - Min ≤ max; units come from the unit Combobox. The data type `bool` gives flag metrics.
  - Disabled templates can't be picked for new devices.
- **Devices**
  - Zone is set and changed **only in the device's own settings**.
  - The one-time credential uses SecretReveal.
  - The connect / firmware-sketch flow is part of the device page.
- **Zones** (see §13 for the backend work)
  - The editor has **name and notes only**: no zone type, and no adding or moving devices from the
    zone editor.
  - The list shows Zone / Devices / Status.
  - Delete is blocked while devices are assigned.
  - The Devices list can filter by zone.
- **Dashboards** are per user. They are edited **in place on the grid**: add, remove and resize
  widgets. No side panel.
- **Members:** role changes happen inline, with a confirmation that states the new permissions.
  Nobody can grant a role above their own.
- **Workspace settings** are saved like a record, with the save bar and change toast. The time zone
  uses the shared time zone select (§9).

---

## 9. Rule editor

The most complex screen. It presents the rule model from `lib/rule-draft.ts` and
`docs/rule-engine-multi-device.md`; it doesn't redefine it.

### 9.1 Creating: recipes

- "New rule" opens **recipe cards for a chosen device** (device select at the top). Recipes are
  generated from what that device can do:
  - Turn on a fan when it's too hot
  - Alert when a door stays open
  - Warn when humidity drops
  - Stop the pump when the tank is low (latches)
  - Tell me when this device goes offline
  - Switch something on a schedule
- **Start blank** is always offered.
- Each card shows an icon, a title, one line on what it does, and tags: *switches hardware* ·
  *latches* · *email*.
- Starting from a device page preselects that device.
- Recipes are built in the frontend as an ordinary draft. There is no recipe entity in the backend.

### 9.2 Layout: workbench

- **One frame for both views**, as on the template page: a **section rail** (When · If · Then ·
  Behaviour · Name) on the left, the **canvas** in the middle, a sticky **340 px right column**, and
  one **sticky save bar** (Discard · Save, "N to fix", "N safety warnings", Ctrl+S). Switching Form ⇄
  Ladder changes only the canvas and what the right column shows; the header, sentence, rail, column
  and save bar stay put.
  - **Form:** the canvas is the section cards; the right column is the preview.
  - **Ladder:** the canvas is the rung; the right column is the **inspector** for the selected element
    (the rule's name and status when *Name* is picked), over the preview folded into one line.
  - **Rail:** each section shows a red count of issues that **block saving**, an amber "!" for
    **safety warnings**, or a ✓ when a new rule's section is complete. In Form it scrolls to the
    section; in Ladder it selects it on the rung. Below 1200 px it becomes a row of chips; below
    1100 px the right column stacks under the canvas.
  - **Validation:** blocking = incomplete trigger, conditions or actions, a clear notification with no
    message, a name over 200 characters; Save goes to the first one. Safety warnings (hold < 5 s,
    interval < 30 s, no hysteresis on a hardware rule) show while typing and in the checks, and never
    block a save.
  - Saving keeps you on the rule; a new rule opens on its own page.
- **Tabs:** **Logic · Activity**. There is no Simulate tab; simulating is part of the preview.
- **Form / Ladder** is a segmented control; Ladder is tagged "expert". The choice is remembered per
  user.
- **New rules show numbered steps:** **1 When · 2 If · 3 Then · 4 Behaviour · 5 Name**, matching the
  rail.
- A dismissible "Three steps to a rule" tip appears on first use.

### 9.3 Editable sentence

- The rule is summarised as one sentence at the top, e.g. "When **temperature on bay1-climate is
  above 27 °C** for **10 s**, **turn fan1 on**…".
- **Every phrase is a chip.** Clicking one opens an in-place popover with Apply / Cancel:
  - Readings: operator and value.
  - Actuators: On / Off.
  - Everything else: "Open full condition".
- Chips are keyboard-focusable. Esc closes the popover and returns focus to the chip.

### 9.4 Preview cards (live as you edit)

1. **Last 24 hours:** a replay strip plus "Would have fired 2× at 09:45, 10:45", or a warning when
   it would fire too often ("noisy"). For schedule rules: "Fires on its schedule".
2. **Would send:** the exact MQTT topic and payload (`{tenant}/{device}/cmd/{actuator}`
   `{ value, ttl }`), the revert/clear command, or the email recipients. Includes a **Dry run with
   live readings** button, which reports what would happen now and **sends nothing**.
3. **Checks:** conditions complete, actions complete, hold ≥ 5 s, minimum interval ≥ 30 s, and
   hysteresis > 0 when the rule switches hardware. Failures show as errors in the form **while
   typing**, not on save.
4. **Other rules on these actuators:** lists other enabled rules on the same device and actuator.
   A conflict (a different value or revert) gets a warning explaining that the last command wins.
5. **Try other values** (collapsed): type values per contact and see the outcome. Focus stays in
   the input while the preview updates.

Replay and dry run read stored telemetry and rollups through the API. They are never on the hot
path (CLAUDE.md §9.1).

### 9.5 Trigger: schedule picker

**Never ask for cron by default.** The schedule is a segmented control:

| Mode | Controls | Stored cron |
|---|---|---|
| **Every day** | hour : minute | `M H * * *` |
| **Certain days** | Mo Tu We Th Fr Sa Su toggle buttons + *Weekdays* / *Weekends* shortcuts; hour : minute | `M H * * d,d` (`1-5` for weekdays) |
| **Repeatedly** | every N **minutes** (1–59) or **hours** (1–23) | `*/N * * * *` · `0 */N * * *` |
| **Monthly** | day 1st–28th; hour : minute | `M H D * *` |
| **Custom** | cron text field (mono, with a hint) | as typed |

- **Time** is entered with two **24-hour selects** (hour 00–23, minute in 5-minute steps; an
  existing off-step minute is kept). Don't use the native time input, because it follows the OS
  locale (e.g. "10:00 p. m.").
- At least one day stays selected. Days 29–31 aren't offered, because short months would skip them.
- A **summary line** under the picker reads e.g. "Runs **weekdays at 22:00** (Mexico City, GMT-6).
  Next: Today 22:00 · Tomorrow 22:00 · Fri 2 Oct 22:00". The next three runs are computed in the
  **rule's time zone**.
- **Cron remains the stored format**, so the backend doesn't change:
  - A stored cron that can't be shown in the simple controls opens in **Custom**.
  - Custom validates each field (numbers, `*`, ranges, lists, steps) with a plain error message.
  - Leaving Custom keeps the time where possible.
- The same plain wording is used everywhere a schedule is shown: the sentence, the Rules list, the
  version history. For example "every day at 22:00", "Tue, Thu at 07:30", "every 15 min", "on the
  1st of each month at 09:00", "weekdays at 08:00 and 20:00".

### 9.6 Time zone select (shared component)

- **Value:** an IANA name.
- **Label:** "**City (GMT±h)**", e.g. "Mexico City (GMT-6)", "Oslo (GMT+2)". The offset is computed
  for today, so daylight saving is correct.
- **Grouped** as Americas · Europe & Africa · Asia & Pacific · Other (UTC), each sorted by offset and
  then city.
- **Where it's used:** rule schedules and Workspace settings. It is one component and one list;
  never hand-roll another.
- A stored zone that isn't in the list is still shown as the selected option.

### 9.7 Safety, behaviour and general

- **Behaviour:** Re-arm vs Latch until reset, as two illustrated radio cards.
- **Hold time, minimum interval and clear delay** are always visible. They are never collapsed
  behind "advanced" (CLAUDE.md §9.7).
- **General:**
  - Rule name, with an auto-generated placeholder ("Left blank, a name is generated").
  - **Status** on **its own full-width row** below the name: a Switch with **Enabled / Disabled**
    (the same words as the header badge) and a hint that changes with it ("Fires when its trigger
    and conditions are met." / "Keeps its settings and history, but won't fire.").

### 9.8 Activity, versions and latch

- **Activity tab:** recent firings, then **Versions**.
  - Each version shows who, when and the change lines.
  - **Restore** loads that version into the draft; nothing is saved until you save.
- **Save** records a version, and the toast summarises it: "N changes: …".
  - The diff covers name, trigger, conditions, actions, behaviour, hold / interval / clear delay,
    **schedule, time zone and status**.
- **Reset latch** is a confirmation that lists the current readings and says whether the rule would
  fire again immediately.

### 9.9 Rules list extras

- Each row shows a 24 h mini strip and "fired N× in 24 h" (or "quiet in 24 h"; schedule rules show
  their schedule).
- A **"shares fan1"** warning tag appears when another enabled rule drives the same actuator.

---

## 10. Public pages

- **Night surfaces:** the landing nav, hero, closing band and footer, and the sign-in brand panel,
  are dark in both themes (the static `night` tokens in `globals.css`). Over them sits the shared
  network canvas: devices in zones around the broker ("RULES · IN MEMORY"), readings in, commands out.
- **Login:** G's split screen. On the left, a night brand panel: the network, a line about the
  product, example reading chips, and the design figures (no live-looking statistics). On the
  right, the card. Below `lg` the panel becomes a band above the card. The card has "Forgot
  password?" on the password label row, **Keep me signed in on this device** (unchecked, the
  session ends with the browser), clear error and loading states.
- **Landing** (`(marketing)`, same tokens and fonts as the app):
  - A text-only night hero over the network canvas, KPIs on a hairline row.
  - The **control-loop card** (G's log of one rule's life: in · rule · cmd · ack · clear) lives in
    **How it works**, under the hot/storage diagram, as the hot path in action.
  - **Onboarding** shows the **journey figure** beside its four steps: one example device's
    workspace, template, generated sketch (filled in, password masked) and the device going
    Waiting → Online with its first reading. The stage it shows is highlighted in the step list;
    it plays when scrolled into view, and reduced motion shows the finished journey.
  - A **Deployment** section: Cloud (shared) · Dedicated cloud · On-premise, plus an edge-connector
    note (CLAUDE.md §3).
  - An **in-page contact form**.
  - Contract terms and data retention are answered in the **FAQ**.
  - **No plan tiers.**

---

## 11. Content and wording

- Sentence case everywhere. Buttons use verbs ("Save rule", "Reset latch", "Add action").
- **Units always shown.** Time is **24-hour**. Recent times are relative ("Today 22:00", "Fired 1 h
  ago"), older ones absolute ("Fri 2 Oct 22:00").
- **Names in the UI:**

  | Concept | UI name |
  |---|---|
  | Device catalog entry | **Device template** (backend: device type) |
  | Rule re-arm | "Re-arm" / "Latch until reset" |
  | Cooldown | **Minimum interval** |
  | `for_duration` | **Hold time** |

- **Status words** come from the §3 vocabulary only. Use the same word in pills, switches, toasts
  and history.
- **Error messages** say what to do: "Enter a number", not "Invalid". **Warnings** explain the risk:
  "This rule switches hardware. Add some hysteresis so noisy readings don't cycle the relay."
- No jargon without explanation. For example, the Ladder view keeps its PLC terms but is marked
  "expert".

---

## 12. Accessibility and responsive

- **Focus:**
  - The focus ring is visible everywhere (2 px accent outline, 2 px offset).
  - Focus is trapped in dialogs and drawers, and returns to the trigger on close.
  - After a re-render, focus stays on the control the user was using.
- **ARIA roles:**
  - radiogroups: segmented controls, trigger options, schedule modes
  - `switch`: Status
  - `aria-pressed`: day toggles
  - `aria-describedby` from every control to its message line
  - `aria-invalid` on errors
- **Hit targets:** at least 36 px, and 36 px minimum on touch for segmented and toggle buttons.
- **Phone:**
  - At 390 px nothing scrolls horizontally.
  - Tables become cards, the workbench preview stacks, and editors open full-screen.
  - Demo controls or floating buttons never cover content.
- **Motion:** honour `prefers-reduced-motion`. Keep transitions under 200 ms and only on
  colour/opacity/transform.
- **Contrast:** meet WCAG AA in both themes.

---

## 13. Functionality G proposes that needs backend work

G is not frontend-only. These need API, schema or migration work, each respecting CLAUDE.md §9:

| Feature | Backend need |
|---|---|
| Zones | New `zones` table with `tenant_id` + RLS policy in the same migration; nullable `devices.zone_id` FK; CRUD + device count; block delete while assigned. |
| Rule versions + Restore | Versions table (rule snapshot, author, time, change lines) with `tenant_id` + RLS; list endpoint. Restore = client loads the snapshot into the draft, then a normal save. |
| 24 h replay, mini strips, "fired N×" | Firing history endpoint; replay evaluates the rule over **rollups** (continuous aggregates), outside the worker, never on the hot path. |
| Dry run | Endpoint that evaluates the draft against the latest cached readings and returns the outcome. **Sends nothing.** |
| Conflicts ("shares fan1") | Query over enabled rules by device + actuator (can be computed client-side from the rules list). |
| Blocked delete / rename warnings | Usage counts: templates→devices, keys→rules/widgets, zones→devices. |
| Recipes, schedule picker, time zone labels, status switch | **No backend change.** Cron + IANA tz and `enabled` are already stored. |
| CRUD fixes | The P0/P1 items in `docs/design/redesign/redesign-report.html`: key freeze, owner-role escalation, disabled templates usable, key format validation, orphaning renames, dropped 422 details. |

Regenerate `frontend/src/types/api.ts` after every schema change (CLAUDE.md §9.8).

---

## 14. Implementation order

Each step is a separate PR and leaves the app fully working.

1. **Tokens and fonts.** Replace the values in `globals.css` and switch to Geist via `next/font`.
   Make light the default. **Rewrite the Control Room comments** in `app/globals.css`,
   `app/layout.tsx`, `app/(marketing)/layout.tsx`, `components/ui/Readout.tsx` and
   `components/ui/Callout.tsx`.
2. **New primitives:** Switch, Toast, Sheet/Drawer, CopyField/SecretReveal, KPI strip, mini strip,
   the `danger` Button variant, and the TimezoneSelect and SchedulePicker components.
3. **Shell:** grouped sidebar, workspace switcher, ⌘K palette, page header, content width, mobile
   drawer.
4. **List-page standard** (§6), applied to Devices first, then the other catalogs.
5. **Editor chrome** (§7): docked / drawer / page, rail, consequence line, save bar, guard, toasts.
6. **Catalogs** (§8), including the Zones backend (§13).
7. **Rule editor** (§9): recipes → workbench → sentence chips → schedule + time zone → versions.
8. **Public pages** (§10).

---

## 15. Reference and changelog

**Reference demos** (open locally in a browser; no build needed):
- `docs/design/redesign/demo-g-full-site.html`: **the reference**.
  - Use the **Demo controls** button (top right) to switch role and theme and to open any route.
  - Hash routes deep-link to pages and editors.
- `docs/design/redesign/redesign-report.html`: the audit, the CRUD matrix, the P0–P2 issues, and
  each version's rationale.
- Demos A–F: history only.

**Changelog**

| Date | Change |
|---|---|
| 2026-09-30 | Initial directives from demo G: tokens (indigo/Geist, light-first), shell, list and editor standards, catalogs, the rule editor rework (recipes, workbench, sentence chips, versions, schedule picker, time zone select, status switch), public pages, the backend work list. |
| 2026-09-30 | Implementation scope: every G feature gets a real backend. Workspace settings carry a **time zone only**; the °C/°F unit option is dropped because display-only conversion makes rule thresholds ambiguous. **Member invites** (7-day email link, accept page) and **forgot password** are in scope. **API keys authenticate** as `Authorization: Bearer`, with an expiry (Viewer or Admin only). The landing page has no public demo tenant, so G's "Open the demo" becomes "Sign in" / "Talk to us". The contact form emails the team and stores nothing. |
| 2026-09-30 | §3: radius tokens expressed on the Tailwind scale the code already uses (`md` controls 8 px, `xl` cards 12 px, `2xl` large 16 px), so no component needs renaming. The theme class becomes `.dark` (light is the unclassed default). |
| 2026-09-30 | §4 shell: routes follow G (`/templates`, `/members`, `/keys`, `/settings`); old `/settings/*` and `/devices/templates*` URLs redirect. The Zones nav item appears together with the zones backend (§13), never as a dead link. Members and API keys are hidden from roles that can't manage them. The Notifications header bell is gone; its unread count is the red nav badge. |
| 2026-09-30 | §8 device templates: key format is **letters, digits, `-` and `_`, up to 64** (no spaces, `/`, `+`, `#` or a leading `$`). G's lowercase-only rule is relaxed because CLAUDE.md §4 keeps an explicit mixed-case key to match already-flashed devices; kebab-case is the project's topic convention. Keys already saved are grandfathered. Actuator keys aren't reserved (their topics are `…/cmd|state|ack/{key}`, so they can't collide with `status`/`config`). Used keys show a lock with **Unlock**, then a rename warning. |
| 2026-09-30 | §8 members: G's **Last active** column is dropped (no per-member activity is tracked); Joined shows instead, and pending invites show their expiry. Invites are their own rows with an **Invited** badge and Resend / Cancel; the role is fixed per invite (cancel and re-invite to change it). The invite accept page is `/invite/[token]`, outside the signed-out `(auth)` group, because a signed-in person accepts there too. Forgot password answers identically for every email so it never reveals who has an account. |
| 2026-09-30 | §8 API keys: a key is `Authorization: Bearer iot_…` and names its own workspace, so `X-Tenant-Id` is optional (it must match when sent). Keys are Viewer or Admin only, default to a 90-day expiry, and work on tenant data routes. They never work on members, invitations, key management or personal dashboards. The list adds an **Expired** status next to G's Active / Revoked, and the quick filter is Active / Revoked or expired / All. Expiry and join dates show as calendar dates ("30 Oct 2026"), not times. |
| 2026-09-30 | §8 workspace settings: one page on the editor chrome (sections Workspace / Alert recipients / Time / Your account / Leave) with a single save bar. As in G, **admins** edit alert recipients and the time zone; only an owner renames. G's °C/°F select is dropped (time zone only). The time zone is the default for new rule schedules; each schedule keeps its own zone, and other times still show in the viewer's local zone. G's disabled "Delete workspace" row is left out until deletion exists. Your own name moved here from the old profile card, and the theme toggle stays in the sidebar footer. A signed-in person with no workspace sees a "Create a workspace" screen instead of a blank page. |
| 2026-10-01 | §8 notifications: each row carries a **severity** (critical / warning / info, shown as the icon) and a **kind**. New sources: *device went offline* (critical, only on a real flip, so a worker restart doesn't re-alert), *delivery failed* (warning, after a webhook or email exhausts its retries), *template updated* (info, only when metrics or actuators change, with how many devices it reaches). The row menu offers Mark as read / unread and Dismiss with Undo; dismissed rows leave the feed for everyone. **Retry** on Rules → Failed deliveries covers webhook and email only. A late actuator command could act on state that has moved on, so those rows say "Not retried" and the rule fires again when its condition holds. A retry re-sends the rule's current action at the same position and is refused if the rule has changed since. |
| 2026-10-01 | §8 device page and connect flow: the device page follows G (header meta row, Overview / Controls / Rules / Settings); the old right-hand rail (status, active rules, recent alerts) is dropped in favour of the header meta and the Rules tab. Readouts show *Last value, X ago* in the warning tone once a device is offline. Connect (`/devices/[id]/connect`) offers the **ESP32 DevKit only**; G's ESP32-S3 option waits until the sketch has an S3 pin map. The live check's "Received its profile" line is left out because the platform gets no signal when a device reads its retained config. Adding a device goes straight to Connect with the new credential carried over in memory (nothing stored), so it is never rotated twice. |
| 2026-10-01 | §8 dashboards: react-grid-layout stays (free placement and resize, beyond G's ordered flow). Widgets move only in **Edit layout** (`?edit=1`): drag by the handle, resize from the corner, cycle width (3, 4, 6, 8, 12 of 12), remove with Undo; changes save as you go. Below 640 px the widgets stack in one column in reading order, and that view is never saved, so a phone can't rewrite the desktop layout. Every member edits their own dashboards. A widget whose device was deleted, or whose metric left the template, says so instead of rendering empty. |
| 2026-10-01 | §9 versions: every rule save that changes behaviour (name, description, enabled, trigger, condition, behaviour and timings, actions, on-clear actions) becomes a numbered version, with plain change lines ("Cooldown: 1 min → 2 min"), the author, and the time. Ladder layout moves are not versions. A rule page **Versions** tab lists them newest first. **Restore** loads an older version into the editor as an unsaved draft, with a banner, and saving it becomes the newest version; nothing is rewritten in place. |
| 2026-10-01 | §5/§6 rules list mini strip: **Last 24 h** is 48 half-hour cells built from recorded firings. A cell is *fired* when a firing landed in it, and *true* across fire → clear for rules with on-clear actions (only those record the clear). It is otherwise *idle*: nothing is guessed between firings. *Unknown* (hatched) marks only the current cell, when the rule can't evaluate now, because past data staleness isn't recorded. |
| 2026-10-01 | §9 workbench: the rule page tabs are **Logic · Activity** (Activity = recent firings, then Versions; the old Simulate tab is gone because the preview simulates). The form sits beside a sticky 340 px preview, which stacks below 1200 px; under Ladder the preview cards form a grid. The preview cards are replay, would send, dry run, checks, other rules on these actuators, and try other values. They use `POST /rules/simulate` with the unsaved draft, which writes and sends nothing. Checks hold hardware rules to a hold of at least 5 s, an interval of at least 30 s, and hysteresis above 0. They warn rather than block saving, so existing rules stay editable. New rules start from recipe cards for a chosen device, or Start blank, and show step numbers 1 When · 2 Then · 3 Safety · 4 Name. The Ladder toggle carries an "expert" tag. |
| 2026-10-01 | §9.3/§9.5/§9.8: the rule summary is the **editable sentence**. Chips cover each reading (operator and value), the hold time, and each on/off actuator, edited in a popover with Apply / Cancel; Esc returns focus to the chip. Range, set and comparison conditions, schedules and non-boolean actuators offer *Open full condition*. The clear clause reads as plain text. Schedules use the SchedulePicker with TimezoneSelect (no cron field by default), and version history words schedules the same way ("every day at 08:00 (Europe/Madrid)"; unusual crons stay as cron). Saving an enabled rule asks for confirmation; the toast lists the version's change lines. Reset latch shows the current readings and a dry run's verdict on whether it would fire again right away. |
| 2026-10-01 | §10 landing: rebuilt in G's order (nav · hero over the network canvas with KPIs · product tour · how it works · safety · onboarding with the ControlLoop · security and operations · deployment · FAQ · close · footer). There is no public demo workspace, so every "Open the demo" becomes **Talk to us** or **Sign in** ("Open console" when signed in). The tour's screens are illustrations built from the app's own components with fixture data, and they are inert. Deployment's Talk to us is a dialog that emails CONTACT_EMAIL_TO through POST /public/contact. It stores nothing, has a honeypot, and allows 5 messages per address per hour. With CONTACT_EMAIL_TO empty, enquiries are only logged. |
| 2026-10-01 | §10 sign-in: every account page (sign in, register, forgot/reset password, invitation) sits on the landing's network canvas with the card centred, as §10 asks; this replaces G's split layout. The password field has Show / Hide and keeps "Password" as its accessible name. A Caps Lock hint appears only after two failed attempts. There is one generic error and never "no such email". An account in more than one workspace chooses one after signing in, unless a ?next= link already says where to go. |
| 2026-10-01 | §10 fidelity pass, superseding the centred sign-in above: the account pages use **G's split screen** (night brand panel beside the card), and the landing takes G's night nav, hero, close and footer, mono eyebrows, numbered step cards, two-column FAQ and the control-loop **log** (replacing the threshold-scope instrument). The canvas is G's broker picture for both. The brand panel shows the design figures (< 2 s, < 500 ms, 500–1,000 devices) instead of G's ticking demo statistics, which would read as live data. "Keep me signed in" is real: unchecked, the refresh token goes to sessionStorage. §9 rule page: G's header (breadcrumbs, state and last firing, consequence line, Duplicate, ⋮ with Run now and Delete, close), the sentence in an accent box, and the ladder's properties in an inspector beside the rung. A duplicate starts disabled. |
| 2026-10-02 | §8 dashboards: **New dashboard** and **Edit details** use the docked editor beside the list (`?edit=new` / `?edit=<id>`), like zones and every other catalog, instead of G's name dialog — one pattern per job. The editor holds the name only (widgets stay on the grid) and links to Open and Edit layout / Add widgets. A row still opens the dashboard. **Duplicate** copies every widget into "Name copy" and docks it for renaming. Renaming from the dashboard page itself keeps its in-place dialog. |
| 2026-10-02 | §6/§7 **Peek everywhere** (user decision, supersedes the docked-editor default and the dashboards entry above): a quick-edit panel beside a full-page edit of the same record was confusing. List panels are now read-only **peeks** (`?peek=<id>`, ↑/↓ to move, Enter to open), and every create and edit is a full page: `/zones/new`, `/zones/{id}`, `/members/invite`, `/members/{id}`, `/keys/new` (shows the one-time secret, then the key page), `/keys/{id}`, `/dashboards/new` (then Edit layout). A device is edited in its page's **Settings tab**; `/devices/{id}/edit` redirects there. Old `?edit=` links redirect to the matching page. With a peek open, the rules list drops its When/Then columns, which the peek repeats. |
| 2026-10-02 | §4/§5/§7 the peek is a **drawer at every width** (user decision after review), not docked beside the list on wide screens. Reasons: one pattern at every size; a full-height pane instead of a short floating card; no layout shift (a docked peek widened the content column from 1120 to 1520 px, moving the header and search). The cost, a modal that blocks the list, is offset by browsing inside it: ‹ › with "n of N", ↑/↓, and focus returning to the row last shown. Dashboards keep the peek on row click, like every list. |
| 2026-10-02 | §8 device page **Settings tab**: one settings page of stacked section cards (~760 px) — General (name, zone) · Rule evaluation · Template (read-only; a device keeps its template) · Connection (MQTT username, **one** "Connect and get firmware" action that states it issues a new credential, MQTT topics) · **Danger zone** last (red outline, Delete). The separate credential, firmware, delete and topics cards are gone. Inside a host page the editor's save bar floats within the column and appears only while there is something to save. |
| 2026-10-02 | §8 device **connect flow** has 5 steps: Credential · **Options** (board ESP32 / ESP32-C3, Wi-Fi from a phone or typed, provisioning security 1 – PoP / 2 – SRP6a, connection, pins, a "The sketch includes" summary; no code) · **Flash** (download / copy, the preview collapsed, upload steps for the chosen board) · **Wi-Fi from your phone** (the ESP BLE Provisioning QR with Download / Print label, app steps; skipped when Wi-Fi is typed in) · Live check. The sketch contains only the chosen Wi-Fi mode. The QR is built from the device's own credential (docs/ble-provisioning.md), so it's only on this page and changes with every rotation. |
| 2026-10-03 | §9.2 rule editor takes **demo A** (`docs/design/redesign/rules-demo-a-rail.html`): the template page's frame — section rail, canvas, 340 px right column, sticky save bar — shared by Form and Ladder, so switching views no longer reflows the page (Ladder's preview grid and full-width layout are gone; the inspector sits in the right column). The rail carries per-section validation: blocking issues (red) vs safety warnings (amber, never block). Saving stays on the rule (§7). §5 Switch: one rule for on/off controls — a Switch for every saved setting (Enabled / Disabled for a record's status, On / Off for options), a checkbox only for list selection and one-time choices; the rule editor's two clear options become Switches and the template's "Availability" becomes "Status". |
| 2026-10-03 | §5 **Trend chart** row added, Readout row extended: on/off metrics are step lines on an Off / On axis on the device page and in dashboard widgets (they used to ramp between readings), with no threshold line; aggregated ranges show "On at any point in the minute/hour" and break the line where the state is unknown. A trend chart widget accepts on/off metrics, but a gauge takes only numbers. One value formatter everywhere ("On"/"Off", not "on"/"off") and template names, not wire keys, in chart pickers and legends. |
| 2026-10-03 | §7 **one record menu, three places**: row ⋯, peek ⋯ and page ⋯ offer the same actions in the same words, naming the action only ("Delete…", not "Delete zone…" / "Delete device…"; "View devices", not "View its devices"). The zones list row menu gains Delete…, which it lacked. A blocked delete is still offered, with the usage count as its hint (zones now match templates). |
| 2026-10-06 | §10 landing: the Product title drops "babysit" ("Everything an operator needs, running without supervision."). Onboarding gets a **journey figure** that illustrates its own four steps (workspace · template · sketch · device online) and highlights the step it shows; the **control-loop log**, which shows what happens after onboarding, moves to How it works as the hot path in action. Step 3 says Wi-Fi is set up from a phone with a QR code (Espressif provisioning), not "over BLE". |
