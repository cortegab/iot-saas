# DESIGN.md — frontend design directives

The single source of truth for how the iot-saas frontend looks, is laid out, behaves and is worded.
It turns the approved **demo G** (`docs/design/redesign/demo-g-full-site.html`) and the responsive,
guided **demo H** (`docs/design/redesign/demo-h-guided.html`) into rules for the real Next.js app.
Read it before building or changing any page or component.

---

## 1. Purpose, status and precedence

**Precedence, highest first:**

1. **`CLAUDE.md` §9 constraints always win.** These cover safety, the 2 s hot path, generated API
   types, RLS and hashed credentials. Nothing here overrides them. For example, flapping controls
   can never be hidden.
2. **This file** is authoritative for frontend look, layout, components, interaction and wording.
3. **Demo H**, then **demo G**, is the visual reference where this file is silent: H for the shell,
   responsive layout and every flow it shows; G for everything H doesn't show (public pages,
   members, keys, zones, settings). When you settle a gap by looking at a demo, write the answer
   back into this file.
4. **Everything else is subordinate**, and gets updated to match this file, never the reverse:
   - code comments (for example the "Control Room" comments in `globals.css`)
   - UI bullets in `docs/history/PLAN.md`
   - suggestions from the `frontend-design` / `ui-ux-pro-max` skills
   - older notes

**Status:**
- Demos G and H are prototypes. Their **behaviour, layout and wording are binding**. Their
  vanilla-JS code is not: build it with the app's React primitives.
- Demo H also shows features that need backend work (§13: the alarm lifecycle, stored "No
  response", widget titles, reported actuator state). Those parts are built only when their backend
  exists; until then the UI shows what the API really has and never fakes the rest.
- Demo H is generated from `docs/design/redesign/src/` (`bash docs/design/redesign/src/build.sh`);
  edit the sources, not the HTML. `docs/design/redesign/index.html` is its overview.
- Demos A–F, the rule-editor demos and the redesign audit were removed on 2026-10-07; they are in git history.
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
| `--h-control` | 36 px: every button, input, select and segmented control (`h-control` utility). **Two control heights only:** 36 px by default and 30 px for buttons of size `sm` (in-row actions, secondary actions inside a panel). Segmented controls and tabs are 36 px everywhere. Nothing clickable is 24, 26 or 40 px. A view's primary action is always the 36 px accent button, inside a tab too. Minimum touch target is 36 px (44 px on touch, §12). |
| `--pad-cell` | 12 px table cell padding (`p-cell` utility) |
| Type scale | **Five steps, through tokens only** (no hand-set `text-[..px]`): `--text-micro` 12 px (tags, counts, micro labels) · `--text-meta` 13 px (meta, hints, table secondary lines) · `--text-sm` 14 px (body, controls) · `--text-section` 16 px (section headings, card titles) · `--text-title` 28 px (page titles, every width). Public pages (§10, the sign-in brand panel included) and live figures (readouts, gauge values) keep their own display sizes. |
| `--shadow-card` | `0 1px 2px rgba(30,30,60,.05)` light; `none` dark |
| `--shadow-pop` | `0 24px 48px -16px rgba(30,30,60,.22), 0 2px 6px rgba(30,30,60,.08)` light; `0 24px 48px -16px rgba(0,0,0,.7), 0 2px 6px rgba(0,0,0,.4)` dark |
| Fonts | **Geist** (display, sans, readouts) and **Geist Mono** (keys, topics, payloads, times in chips), loaded via `next/font`. Replaces Chivo / IBM Plex. |

- Page titles are 28 px, weight 600, letter-spacing −0.015em (the sign-in card too).
- Section headings are 16 px, weight 600.
- Numbers use `tabular-nums`.

### Status vocabulary

| Entity | States (word + tone + dot) |
|---|---|
| Device | Online (online) · Offline (offline) · Never connected (pending) · Disabled (unknown) |
| Rule | Armed (online) · Fired (accent) · Latched (pending, square dot) · Disabled (unknown) |
| Data freshness | Live · Stale (unknown, `.is-stale` 60 % opacity) · No data |

**One badge.** In tables, lists and previews a status is a **dot + word** with no fill (`Badge variant="dot"`), in its tone. A tinted fill is only for a state that needs attention in a page header (a state chip). Counts that need someone ("6 offline") are a dot + word in the error tone, never bare red text. **Roles** (Owner · Admin · Viewer) are one neutral style for every role. Separators ("·") join only values that exist.

---

## 4. App shell

The shell has three forms, chosen by the width of the app (breakpoints in §12):

| Width | Navigation |
|---|---|
| **≥ 1440 px** | The full **sidebar**, 256 px, always open. |
| **641–1439 px** | An **icon rail**, 64 px: workspace logo, search, one icon per nav item (groups separated by a hairline), the avatar with a live dot. Each icon shows its label in a floating tooltip on hover and focus. A pin button opens the full sidebar **over** the content (it never pushes it) until it is pinned closed again. Counts hide; the red alert count stays on its icon. |
| **≤ 640 px** | A **top bar** (logo, app name, the live indicator only while reconnecting, search) and a **bottom tab bar**: Dashboards · Devices · **Alerts** (with the active-alert count) · Rules · **More**. More opens a bottom sheet with the user, the theme toggle, the live indicator and the rest of the nav. |

- **Sidebar** (full form) is 256 px wide and sticky. From top to bottom:
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
- **Page header** (one component, `PageHeader`, for lists, record pages and editors): breadcrumbs,
  an overline, an H1, a one-line description, and actions on the right. The overline starts with
  the **status**, then meta; the line under the title is the description only. Actions align to
  the **H1 row** (top-aligned), the primary rightmost and ⋯ last. On phones the actions are one
  row directly under the title, primary first, ⋯ last. A title is plain text (no monospace part).
  **Nothing is said twice:** the breadcrumb lists the **parents only** (the H1 right below names
  the current page); the overline carries **status and meta only**, never the record kind (the
  breadcrumb says it); the description never restates the overline. **Creating** a named record
  (a device template, a device), the H1 is the name as it's typed, and "New device template" /
  "Add device" while the box is empty.
- **Content column**: max 1120 px on every page (the 1520 px wide view is gone; nothing used it once
  the rule editor joined the standard layout). Every editor, wizard
  and settings page, the rule editor included, holds to a **760 px column** inside the 1120 px page,
  so every editor shares one left edge. Supporting content (the rule preview) opens from a
  button in a sheet, never a reason to widen the page. A list never
  changes width: its peek opens as a drawer over it.
  Padding is 36 px top, 40 px sides and 110 px bottom so the save bar never covers content.
  Below 641 px the padding is 16 px at the sides, and the bottom padding clears the tab bar
  (which hides while a save bar shows, §7).
- **Reconnecting banner:** while the live connection is down, a banner at the top of the content says
  "**Reconnecting…** Live updates are paused, so values on this page may be stale." The live
  indicator turns pending. Both go when it reconnects.
- **Skip link:** "Skip to content" is the first focusable element and moves focus to the content.
- **Landing:** every entry point (sign in, register, an accepted invite, the landing page's
  "Open console", switching or creating a workspace) goes to `/home`, which asks the API once
  (`GET /tenants/current/landing`) and replaces itself with, in order: **Get started** for an
  owner or admin while setup is unfinished and not dismissed; the one-time **Welcome** for
  someone with no dashboard here yet; their **default dashboard** (§8); the dashboard they
  opened last on this browser; their most recently changed one; else **Devices**. A `?next=`
  link (an invite, a deep link) skips it. Get started is §10.1 and Welcome §10.2.

---

## 5. Components

Build every screen from these. **Existing** means the file is in `frontend/src/components/ui/` and
gets restyled to the tokens. **NEW** means it has to be created.

| Component | Status | Directives |
|---|---|---|
| Button | existing | Variants: `primary` · `secondary` · `ghost` · `danger` (filled) · size `sm`. One primary per view. Labels are verbs ("Save rule", "Add device"). **Destructive:** on a page, the entry point is a `secondary` button with red text and an ellipsis ("Rotate credential…", "Leave workspace…"); the filled `danger` button lives only in the confirmation dialog. |
| Field | existing | Label above, control, one message line below. That line holds the hint, or the error/warning replacing it (`aria-describedby`). Errors show on blur or submit; **safety errors show while typing**. Optional fields say "optional" in the label. The hint says what the field affects; a link to manage the related records ends the hint ("Where it's installed. Manage zones"), never on its own line. Short related fields pair two across (one across on phones); long or complex controls take the full column. **Inline** (`inline`): label on the left, control and message on the right; only for a list of like fields that map one thing to another (a driver's readings). |
| Input / Select / Textarea | existing | 36 px, `--color-input` fill, mono for keys/topics. Affix (suffix unit such as `s`, `°C`) inside the control. |
| Combobox | existing | For long lists with search (units, devices). |
| SegmentedControl | existing | Mutually exclusive modes (Form / Ladder, schedule repeat mode). `role="radiogroup"` or pressed buttons. Always the 36 px control height (30 px segments in a 3 px inset), 44 px on touch; `md` / `sm` set only the text size. |
| **ChoiceCards** | NEW | Radio cards for a choice whose options each need a line of explanation (Add device's start, Runs on). Two across, one across from 560 px down; a radiogroup with arrow keys. Not wrapped in a Field label, which would name the first card. |
| **Switch** | NEW | Every on/off **setting that is saved with a record** (`SwitchField`): a label naming the setting above, the switch beside a **state word**, and a hint below that changes with it. State words: **Enabled / Disabled** for a record's own status (label "Status": rule, device, template), **On / Off** for an option inside a record (e.g. "Turn it back when the condition clears", "Send a notification when it clears"). A **checkbox** is only for picking items in a list (bulk select) or for a one-time choice that belongs to a single submit and isn't stored as a setting ("I've stored it", "Keep me signed in on this device"). List row menus use the verbs **Enable / Disable**. |
| Tabs | existing | Underline style, the control height (36 px). **Never wrap**: when the tabs don't fit (phones), they stay on one row that scrolls sideways with an edge fade and no visible scrollbar, and the active tab scrolls into view. Editor tabs carry the section's red problem count or amber "!", live in the URL (`?tab=`), and move with the arrow keys. |
| Badge / Tag | existing | Pills with a status dot. `tag--warn` (pending surface) for conflicts ("shares fan1"). `tag--sm` for qualifiers ("expert"). |
| Callout | existing | `info` (accent-muted), `warning` (pending surface), `error` (error surface). Dismissible for tips only. **A record's lasting state is not a callout** unless it holds the action that resolves it (Latched + Reset latch, a restored version + Discard, Waiting for its first message + Connect): otherwise it is a **state chip** in the header's meta row (amber, with the detail in a popover on click or focus), and never repeats what the header already says ("Offline · last message …"). |
| **Toast** | NEW | Bottom-right, stacked. Title plus a detail line; save toasts carry the **change summary** ("2 changes: Schedule: … → …"). Toasts are for **events**: something the person did, or a record's state **changing while its page is open** ("ESP32-I1 went offline", "Can't evaluate: input1 is stale"). Never for a state that was already true on load, and never as the only place a lasting state is shown. |
| ConfirmDialog | existing | For destructive actions and guards. Title states the action; the body states the consequence with real numbers; the danger button repeats the verb. |
| **FactList** | NEW | Read-only facts of a record as a definition list: a muted label column (140 px) and the value, stacking on phones. A value links to its source ("ESP32 Inputs · Our firmware") and may carry inline link actions (**Copy**, **Rotate credential…**, a disclosure). Never a disabled input, a grey box or a loose sentence for a fact. |
| **Inherited** | NEW | A value that follows another record's unless overridden (a device's wiring from its template, a rule email's recipients from the workspace): says what it follows and from where, shows that value read-only, and offers **Use a different …**; once overridden, the field plus **Use the {source}'s …**. |
| **Sheet / Drawer** | existing | The record peek and the item sheet (§7), 560 px, full height, from the right. **Bottom** placement on phones (≤ 640 px) for the More menu, sentence editors and short pickers: rounded top, a grab handle, up to 85% of the height. Scrim + focus trap + Esc; focus returns to the trigger. On phones the **record peek** fills the screen, and its ‹ › ⋯ × controls take their own row above the title so the title keeps the full width. |
| **Wizard** | NEW | Creating a record (§7). Numbered steps (done ✓ / current / red when a step has a problem); on phones "Step n of N · Name" over a thin progress bar instead. Each step opens with a question as its heading ("What starts it?"), which takes focus, and a one-line lead. The save bar holds **Back** and **Next: {step}**; the last step is **Review**, a definition list with a **Change** link per row, and the primary button names the result ("Create rule"). Next is refused while the step has blocking problems: they are marked and the first takes focus. A step turns red, and counts in the bar's "N to fix", only once it has been visited or a Create was refused, never before the author has seen it. |
| **Line row** | NEW | One child item as one line (a part, metric, actuator, condition, action, alarm): icon, a bold name with a muted second line, tags, and a chevron. A red count or amber "!" marks its problems. Clicking or Enter opens its item sheet. Rows stack in a bordered **Lines** group. |
| **CopyField / SecretReveal** | NEW | One component for every one-time secret (device token, API key). It replaces the four copies in the devices and tokens pages. Shown once, with a copy button and a "won't be shown again" warning. |
| **ProgressBar** | NEW | Only for a running job with real steps (the device Install). 6 px `--color-border` track, `--color-accent` fill, fully rounded. Determinate when the share done is known (with the % in words beside it); otherwise a sliding segment, static under reduced motion. Stage text sits above it, in words, never just a bar. `role="progressbar"`. |
| EmptyState / ErrorState / LoadingSkeleton | existing | Every list and panel has all three. Empty explains why and offers the primary action. Error and empty never render together. A record page whose record doesn't exist (a 404, or an id missing from a loaded list) shows **NotFound** (`components/ui/NotFound.tsx`): "This {noun} doesn't exist", why, and *Back to {list}*; never an error with Retry, never a skeleton that doesn't end. |
| Table | existing | See §6. |
| **KPI strip** | retired | No page uses it: every list, the alerts inbox included, filters by state from the toolbar's status filter (§6). |
| **Mini strip / sparkline** | NEW | 48-cell 24 h strip (true / unknown-hatched / fired) for rules. Sparkline for readings. Uses `--color-chart`, with accent for fire marks. |
| Readout / Metric | existing | Live values in Geist, tabular-nums, unit in muted. Stale values dim. A metric is named by its template **name** everywhere (readouts, chart pickers, legends, widget titles), with its wire key only when undeclared. Every surface formats a value the same way (`formatReading`): an on/off metric reads **On / Off** (capitalised, no unit), a number uses the template's decimals. |
| **Trend chart** | existing | One component for the device page and the dashboard widget. A number is a line with a faint `--color-chart` gradient under it (about 18% at the top, fading to nothing at the bottom of the plot), with dashed rule thresholds. No reading markers on any metric: the line is the reading. An **on/off metric** is a **step line** on an **Off / On** axis with a light wash under On, and has no threshold line. Once aggregated it stays on Off / On: a minute or hour shows On if the metric was On at any point in it. The state is carried forward only from a bucket that held one state, otherwise the line breaks until the next reading. Never ramps, never a "% of readings". Gauges take numbers only. Ranges **1m · 10m · 1h · 6h · 24h · 7d**, opening on 10m. The time axis always spans the whole window ending at now and **slides forward live**, so gaps show as empty space; a drag-zoom pauses the slide and a double-click resumes it. A window with no readings keeps the empty frame with a muted "No readings in the last {range}", so the next reading appears in place. |

---

## 6. List pages: the catalog standard

**Every catalog list uses the same anatomy, in this order:**

1. Page header (§4): the title with its one-line description **beside it** on the same baseline
   (it wraps under the title when there's no room). The header holds the primary action only
   while there is no toolbar: loading, error, first use.
2. **Toolbar**, two rows:
   - Row 1: search, filter menus, the view switch where there is one, and the primary "Add … /
     New … / Invite" action at the end.
   - Row 2: the **status filter**, a segmented control with a count per state (All · Online 5 ·
     Offline 3 · …), each state with its dot. It replaces the KPI strip on list pages: a state
     that needs someone (offline, latched, can't evaluate) shows its count in red when it isn't
     zero, and what each state means is its hover title. Every list with states has one
     (Templates Enabled / Disabled, Zones In use / Empty, Members Active / Invited, API keys
     Active / Revoked or expired, Notifications All / Unread and one state per type, the types
     counting unread alerts); Dashboards has none. A list with a closely related feed may add it
     as a last state that swaps the table for that feed (Rules → **Failed deliveries**); there are
     no tabs above a list.
3. **Active-filter chips** with a "Clear all" action; the result count is in the table footer.
4. **Table**:
   - Sortable columns (the header shows the sort direction).
   - A name cell with a secondary line.
   - Status pill, right-aligned numbers, and a row actions menu (⋯).
   - Bulk-select checkbox column where bulk actions exist.
   - Hover highlight; clicking a row opens its **read-only peek** in a drawer over the list (§7).
     The name is a link to the record's page. Enter on a focused row peeks it; Enter again opens the
     page.
5. **Table footer**: the count, page size (Rows 25 / 50 / 100) and a **numbered pager**: `‹ 1 2 [3] 4 … 9 ›`, the first and last page, the current one and its neighbours, ellipses between (`nav` "Pagination", the current page `aria-current`). On phones it collapses to `‹ 3 / 9 ›`. Below 25 rows only the count shows.
6. States: loading skeleton rows · empty (first-use) · no results (with "Clear filters") · error with a retry.

| List | Columns |
|---|---|
| Devices | Device · Template · Zone · Status · Last seen |
| Device templates | Template · Metrics · Actuators · Devices · Status |
| Zones | **Zone · Devices · Status** (no Rules column) |
| Rules | Rule (+ 24 h mini strip, "fired N× in 24 h", "shares X" tag) · Trigger · Action · State |
| Dashboards | Dashboard · Widgets · Updated |
| Members / API keys | Name · Role/Scope · Last active · actions |

**As the content narrows** (widths of the content column, not the window):
- Columns fold by priority. Each table marks its columns P2 and P3. Below 860 px the P3 columns go,
  and below 720 px the P2 columns go. A folded value moves into the name cell's secondary line, so
  nothing is lost. Name, status and the row menu never fold.
- At 600 px and below, rows become **stacked cards** with the same fields.
- On phones the filter menus move into a **Filters** button that opens a bottom sheet, and the
  status filter becomes a select ("Offline (3)"). Search, the primary action and the active-filter
  chips stay in the toolbar.

**Rules list:** the status filter is All · Armed · Fired (24 h) · Latched · Can't evaluate ·
Disabled · **Failed deliveries** (a state that's on also shows as a chip, like any filter). The toolbar adds
Device and Trigger filters and a **List / Ladder** view switch. Failed deliveries counts deliveries,
not rules, in red when any: choosing it shows the delivery feed (When · Rule · Action · Error ·
Retry) and hides the rule-only search, filters and view switch. `/rules/failed-actions` redirects
to `/rules?state=failed`. Ladder shows each rule as a card with
its read-only rung; a card opens the rule.

---

## 7. Editors: one editing model

Every create/edit flow, whether catalog record, rule or settings, uses **the same editor chrome**.
**To create, you go step by step; to edit, you use short tabs; one item at a time opens in a side
sheet.**

| Presentation | When |
|---|---|
| **Peek**: a drawer over the list, at every width | **Looking only.** Key facts, status, the next step and a ⋯ menu. The overline carries status and meta, never the record kind. The main button is always **Open {noun}** (Open device, Open rule, Open template…). The facts fill the drawer with what a look needs: a device's latest readings and health, a rule's sentence and recent firings, a template's devices. No fields, no save bar. `?peek=<id>`. The drawer blocks the list, so browsing happens inside it: ‹ › with "n of N", and ↑/↓ while focus is in the drawer. Closing returns focus to the row last shown. |
| **Full page, creating** | A **Wizard** (§5) at `/x/new`: a few steps, each asking one question, ending in Review. Records with one short section (a zone, a key, a dashboard name) skip the steps and use one form. |
| **Full page, editing** | `/x/{id}` (a device: its page's Settings tab). Short **tabs** of sections (`?tab=`), with the title, consequence line and save bar shared across them. Deep-linkable. |
| **Item sheet** | One **child item** of the record being edited (a part, a metric, an actuator, a condition, an action, a widget): its Line row opens it in a side sheet (a bottom sheet on phones). The sheet edits the page's draft live. It has **Done**, never a save of its own; the page's save bar saves, and the unsaved-changes guard covers it. A newly added item opens its sheet straight away. |

One place to look and one place to change each record; "New" goes where "Edit" goes. A sheet never
edits a whole record, and there is no "Expand" toggle.

**Shared chrome:**
- A title ("Edit rule", "New device template") and a record menu (⋯: Duplicate, Delete).
- **Tabs** when editing, **steps** when creating. Both carry each section's red problem count or
  amber "!". Saving with a problem switches to the first tab (or step) that has one.
- **Sections** are plain, divided by hairlines (no cards), each with a heading and an optional
  one-line lead that explains the concept ("A device keeps the template it was added with.").
  A heading never repeats the record kind ("Zone", "Key"), the tab label ("General" under General)
  or a wizard step's question; a page, tab or step with **one section has no section heading**.
- A **consequence line** under the title that says what saving does ("Saving applies within a
  second. It watches 1 device and can switch 1 actuator").
- A **save bar** at the bottom of the window, full width. **Editing:** it appears (slides up) only
  while there is an edit, a save in progress or a problem to fix, with "Unsaved changes",
  **Discard** and **Save**; Save and Discard hide it again, and the save toast confirms. **Creating**
  (a form or a wizard): always shown, with the state line **Not created yet** whatever has been
  typed, since it holds **Create** / **Back** / **Next**, and offers
  **Cancel** (always enabled, back to where you came from), never a greyed-out Discard. Save
  focuses the first error when invalid. One bar on every page (`SAVE_BAR`), the same width and
  height everywhere. At content ≤ 480 px the status line takes its own row and the buttons share
  the full width. On phones the **tab bar hides while the save bar shows** (Cancel / Discard is
  the way out; the unsaved-changes guard still covers navigation).
- An **unsaved-changes guard** on close, navigate and reload.
- **Post-save toast** with the change summary. The editor stays on the record after saving; it
  doesn't redirect somewhere else.
- **Delete lives in the record menu (⋯) only**, never also as a section at the end of the page.
  A danger section exists only on a page with no record menu (Workspace settings → **Leave
  workspace**).
- **Delete blocked** with an explanation and links when the record is in use ("3 devices use this
  template"). A delete that is allowed confirms with the real consequence.
- **One record menu, three places.** The list row ⋯, the peek ⋯ and the page ⋯ offer the same
  actions with the same words. Menu items name only the action, because the record is implied:
  **View devices**, **Duplicate**, **Enable / Disable**, **Delete…**. An ellipsis means a dialog or
  confirm follows. **Delete…** is last, on its own, in the danger style. While the record is in use
  it is still offered, with the usage count as its hint ("2 devices are in it"), and picking it
  explains the block. A standalone button outside a menu (Workspace settings' danger section)
  keeps the noun: "Leave workspace…".
- **Rename warnings** when a key is referenced ("`temperature` is used by 3 rules and 2 widgets").
- Read-only mode for roles without edit rights shows a banner, disabled controls and no save bar.
- **Deep links:** every record and every editor state has a URL (list, list + peek, full page,
  section). The page's breadcrumb returns to the list with that record peeked.

---

## 8. Catalog-specific rules

- **Defining a device: one model for templates and onboarding**
  - **Runs on** is the first question for anything new, and is stored on the template:
    **Our firmware** (pick the parts; installs from the browser) or **Custom firmware** (list the
    data it sends). It sets the steps and tabs everywhere that template is made or edited:
    - Our firmware: creating is **Basics → Hardware → Data → Review**; editing is tabs **General ·
      Wiring · Data**. Parts bring their metrics and actuators; Data (metrics, then actuators) keeps
      the detail settings (publish, deadband, min/max, On/Off values).
    - Custom firmware: **Basics → Data → Review**, and tabs **General · Data**, with no Wiring.
      Install offers the sketch and the topic contract.
    - Parts, metrics and actuators are Line rows; each opens in its item sheet (§7).
    - A gateway or edge connector also works as Custom firmware today: anything that speaks the
      device contract with the device's credential. The label doesn't name gateways until gateway
      support exists (SCOPE.md §3); then it becomes **Custom firmware or gateway** again.
  - **Metrics are the record that lasts.** Rules, dashboards and history point at keys, never at
    parts or pins. A part suggests metrics when added; after that, **Replace part** swaps the driver
    and keeps each reading's metric. Removing or replacing a part names what depends on its keys
    ("2 rules and 1 dashboard use *temperature*") and offers to keep the metric.
  - **Readings are named on the part card.** Each reading shows the metric it feeds, editable in
    place (name, and the key while it is still free); key clashes show there. A **What you'll see**
    line under the parts lists the resulting metrics and actuators.
  - A part with many readings (MPU6050) asks **which readings to keep**, the common ones ticked.
    An unticked reading makes no metric. A wired part collapses to one line: driver · pins ·
    readings.
  - A metric that no part feeds, in an Our firmware template, carries the tag **Not wired** with
    the hint "Your firmware must publish this".
  - **Wiring has one home: the template.** A device's own wiring is the exception, edited with the
    same Wiring section in its Settings tab and tagged **Own wiring** wherever the device is listed.
  - **Board** is picked from a list grouped by chip, each model tagged with what it can do
    (**Phone setup** when it has BLE, **RGB LED**). **Detect my board** connects over Web Serial,
    reads the chip and narrows the list to its models; the user still picks the model, since boards
    with the same chip look alike. Only the drivers the chosen board's firmware carries are offered;
    changing the board lists, in one summary, the pins that moved and the parts it can't run.
- **Add device**
  - Two starts: **From a template** (name, template, zone; one form) and **Something new**, the
    template wizard in onboarding mode: Basics asks "What is it?" (device name, zone, Runs on), then
    Hardware → Data → Review. "Create device" makes the template and the device together, then
    opens Connect.
  - Onboarding names the template itself and keeps the name out of view. Templates surface on
    reuse: after creating, **Add another like this**; and when a new device's parts and keys match
    an existing template, "Matches *Greenhouse node*. Use it?"
- **Device templates**
  - Key slug generated live from the name, with a lock icon once the key is used.
  - Reserved keys (`status`, `config`) and duplicates are rejected inline (CLAUDE.md §4).
  - Min ≤ max; units come from the unit Combobox. The data type `bool` gives flag metrics.
  - Disabled templates can't be picked for new devices.
  - A **Wiring** section (Our firmware templates only; the Hardware step and the Wiring tab, see above) says how the
    board is wired for the generic firmware: board, then input and output cards, then a generated **wiring guide** (pin table +
    per-driver notes). Each card reads top to bottom in labelled blocks: **Driver**, **Connection**
    (pins, or the I2C bus line plus the part's address), **Settings** (params), then **Readings**
    (inputs) or **Commands** (outputs): one inline Field per channel, the channel on the left and
    the metric it feeds or actuator it drives on the right. A metric is fed, and an actuator driven,
    by one channel only, so the pickers offer only free ones (a picker keeps its own choice). Drivers, pin
    roles and params come from the published firmware's driver catalog; with none published the
    section says so instead of offering anything. Pin problems (clash, ADC1, input-only) are
    errors on the pin field; type mismatches (an on/off reading feeding a number) are warnings.
  - **Board** is a board model, by its sales name ("ESP32 DevKit (30-pin)", "ESP32-C3 Super
    Mini"), with its one-line description as the hint. Pin pickers offer only that board's header
    pins, by number plus the printed label where it differs ("GPIO 36 (VP)"). Changing the board
    keeps the wiring and flags each pin the new board lacks; the guide adds the board's own notes
    and how to set up its Wi-Fi again.
- **Devices**
  - Zone is set and changed **only in the device's own settings**.
  - The one-time credential is shown as read-only fields with Copy (Connect's Store its credential).
  - The connect / firmware-sketch flow is part of the device page, and is a step-by-step wizard
    (Credential · Options · Install · Wi-Fi from your phone · Live check), with a side list of the
    steps on wide screens and "Step n of N" on phones.
  - **Connect always starts by creating or rotating the credential** (user decision 2026-10-27):
    the Credential step shows **Create credential** (never connected) or **Rotate credential…**
    (with its confirm), and only then **Store its credential**: Username and Password as read-only
    fields with Copy, "It won't be shown again", **I've stored it**, Continue in the bottom bar.
    Add device doesn't carry its credential over. The credential is held **in the page only**
    (never stored in the browser): a reload or leaving drops it, and the next visit creates or
    rotates again. Leaving or reloading before it is stored asks first ("Leave before storing the
    password? It's shown only once…").
  - **Controls** (device Controls tab and the actuator widget) show what was **requested** and what
    happened: *Waiting for the device… {n} s* (counting down the command's TTL), then
    **Acknowledged**, or **No response within {ttl} s** with **Retry**. A command sent to an offline
    device says so before it is sent. Below the controls, the **command timeline**: time, actuator,
    value, who or which rule, and the result (Acknowledged / Pending / No response), filterable by
    result and actuator. A run of commands to the same actuator from the same sender with the
    same result is one row (time span, values "Off / On", **×N** that expands it). "Device
    reports {value}" appears only once devices report their state (§13).
  - **Install** (a device whose wiring is set, its own or its template's):
    - **Options** shows a **Wiring** card instead of Board and pins: the board model, the pin table,
      and "Change the wiring".
    - Step 3 is **Install**, not Flash: Install firmware (primary), Update config only (secondary),
      board hints, progress, and a result callout. The sketch stays under "Advanced: download the
      sketch instead".
    - A first Install erases the board's saved Wi-Fi; Update config only keeps it.
    - With no Web Serial, a warning callout replaces the buttons.
    - A board without BLE has no phone setup: **Options** offers only **Type it in** for Wi-Fi,
      already chosen, with the hint "Saved on the board with its config. Anyone holding the board
      can read it." Changing networks means running Install (or Update config only) again.
    - The live check waits only for what's wired.
  - **Broker host** (every device) is an editable field. It defaults to the page's host, and it's
    an error when the host is `localhost` / `127.*`, because the board can't reach it.
- **Zones** (see §13 for the backend work)
  - The editor has **name and notes only**: no zone type, and no adding or moving devices from the
    zone editor.
  - The list shows Zone / Devices / Status.
  - Delete is blocked while devices are assigned.
  - The Devices list can filter by zone.
- **Dashboards** are per user. They are edited **in place on the grid** (Edit layout): drag and
  resize as before, and **click a widget** to open its item sheet: Type, Device, Reading (or
  Actuator), Title (optional, once §13 lands) and Size (S · M · L · Full = 3 · 4 · 8 · 12 columns),
  applied as you change them, with **Remove widget** in the sheet. **Add a widget** is a sheet with
  three steps: Type → Source → Size. On phones, Edit layout shows a **reorderable list** of the
  widgets (open, remove, move up / down) instead of the grid. Moving a widget swaps its grid place
  with its neighbour's in reading order, so the desktop layout stays intact apart from that swap.
  **Default dashboard:** each person may mark one of their dashboards **Set as default** (row
  menu after Edit layout, the peek's ⋯ and the dashboard's ⋯; **Remove as default** undoes it).
  It's where they land after signing in; the nav's Dashboards always opens the list (user
  decision 2026-10-29). A **Default** tag marks it in the list and the page header. One per person per workspace, stored on the
  server. Deleting it says so in the confirm; the next landing falls back to the dashboard opened
  last.
  **Attention strip:** above every dashboard (not while editing its layout), a warning callout
  "Needs attention:" listing only what's non-zero: **N critical alerts** (unread, rows of repeats)
  · **N devices offline** · **N rules latched** · **N rules can't evaluate**, each linking to its
  filtered list (`/notifications?state=unread&severity=critical`, `/devices?status=offline`,
  `/rules?state=latched`, `/rules?state=stale`). When nothing needs someone it isn't there at all,
  so it never becomes wallpaper. Realtime refreshes it on notification, device-health and
  rule-health events.
- **Notifications** (the tab bar calls it **Alerts**): one Line row per alert, with severity icon,
  title, detail, device and rule links and the time. Repeats of the same alert from the same source
  group into one row (**×4**, "since Fri 2 Oct 09:12, last 2 min ago"; dates in the one §11
  format, never the browser's language). The API groups, filters and pages, so the ×N counts and
  the numbered pager (§6, 25 / 50 / 100 alerts) cover the whole history. The status filter (§6)
  is All · Unread, then unread alerts by type: **Offline · Rules** (fired or cleared) **· Rule
  health · Failed deliveries · Templates**, counted per row of repeats, never per notification;
  the nav badge counts the same unread alerts. **Mark all as read** is the toolbar action.
  Filters: severity, device, rule. The sheet lists each time the alert happened, paged.
  **Unread** is the 3 px accent bar and a bold title, nothing more: no Unread pill and no row
  button. Mark read / unread and Dismiss are in the row ⋯ menu; opening an alert marks it read.
  A row opens a sheet with the details. With the alarm lifecycle (§13) it becomes an alarm inbox:
  states **Active · Acknowledged · Cleared · All** with counts, active critical and warning
  alarms in red, **Acknowledge…** with an optional note (one or many, with Undo), "Acknowledged by *name*
  2 min ago: *note*" for everyone, a timeline per alarm, and the bell and the Alerts tab counting
  active alarms only. Until then they count unread.
- **Members:** a role is changed on the member's own page (`/members/{id}`), with a confirmation that states the new permissions; invites are their own rows (changelog 2026-09-30, 2026-10-02).
  Nobody can grant a role above their own.
- **Workspace settings** are saved like a record, with the save bar and change toast. The time zone
  uses the shared time zone select (§9).

---

## 9. Rule editor

The most complex screen. It presents the rule model from `lib/rule-draft.ts` and
`docs/rule-engine-multi-device.md`; it doesn't redefine it.

### 9.1 Creating: recipes

- "New rule" opens on the **recipe cards** and **Start blank**; the name is asked once, on Review
  (user decision 2026-10-29). There is **no device select**: one rule can read one device
  and switch another, so devices are picked in the steps (user decision 2026-10-27). Every recipe
  is always offered:
  - Tell me when a device goes offline
  - Turn something on when it's too hot
  - Alert when a door stays open
  - Warn when humidity drops
  - Stop the pump when the tank is low (latches)
  - Switch something on a schedule
- A recipe arrives with its parts in place (the comparison and a sensible limit, the action and
  its value, behaviour and timings) and **no device**: each reading, switch and watched device is
  picked in the When / If / Then steps, whose Next waits until it is. Each recipe suggests a
  name ("Device offline", "Humidity low"; from a device page with its names), changed on Review.
- Picking a recipe or Start blank opens the **new-rule wizard**: **When → If → Then → Behaviour →
  Review**, without Behaviour for a rule not on a reading (§9.7). Each step asks its question ("What starts it?", "What has to be true?", "What should happen?", "How
  should it behave?") and uses the same section body as the matching edit tab. The sentence stays
  on top and fills in as you go; the preview is behind its button (§9.2). Review holds the name
  (pre-filled by the recipe, empty for Start blank: "Left blank, a name is generated") and Status,
  then **Create rule**. Back on the first step returns to the recipes.
- Each card shows an icon, a title, one line on what it does, and tags: *switches hardware* ·
  *latches* · *email*.
- **From a device page** (`?device=`), the recipes that device can run come first, already filled
  with it (its names in their titles); the rest stay device-free. Start blank starts with it too.
- Recipes are built in the frontend as an ordinary draft. There is no recipe entity in the backend.

### 9.2 Layout: tabs and preview

- **Top of the page:** the header (breadcrumbs, state and last firing, Run now…, ⋯) whose
  description is the **editable sentence** (§9.3), so the tabs sit right under it like every
  other editor's (user decision 2026-10-29). The latched and restored-version callouts (each holds
  its action) sit between the header and the tabs; can't-evaluate is a **state chip** in the
  header's meta row (§5 Callout).
- **Tabs:** **Basics · When · If · Then · Behaviour · Activity** (`?tab=`, opening on Basics).
  Basics holds **Name** and **Status** side by side, then the consequence line ("Saving applies
  within a second. It watches 1 device and can switch 1 actuator."). The tabs from Basics to
  Behaviour carry their section's red problem count or amber "!"; Activity holds recent firings,
  then Versions (§9.8), and has no save bar. **Behaviour** is only on rules on a reading (§9.7). Nothing else is a tab: there is no Logic tab, no section
  rail and no inspector column.
  - **When:** the trigger as radio cards (each reading · a schedule · manually · device online /
    offline), then the reading or the schedule picker (§9.5).
  - **If:** the conditions (§9.3), **Then:** the actions and the clear actions. Both carry the
    **Form / Ladder** switch (§9.10).
  - **Behaviour:** Re-arm vs Latch, hold time, minimum interval and clear delay (§9.7).
  - **Preview** sits at the end of the tab row on When, If, Then and Behaviour.
- **Layout:** the standard 1120 px page with the 760 px editor column (§4), same left edge as
  every other editor. The **preview** (§9.4 cards) is **only behind the Preview button**, at every
  width (user decision 2026-10-27): it opens the cards in a sheet (bottom sheet on phones). The
  new-rule Review step shows them inline. The **Ladder** canvas (If / Then in Ladder view) is a
  diagram and may use the page's full width, so a wide rung keeps scaling instead of turning
  vertical.
- One **save bar** (§7: only while editing; always while creating): Discard · Save rule, "N to fix",
  Ctrl+S. Safety warnings show on the Behaviour tab's amber "!" and in the Checks card.
- **Validation:**
  - Blocking: incomplete trigger, conditions or actions; a clear notification with no message; a
    name over 200 characters. Save goes to the first one's tab and focuses it.
  - Safety warnings (hold < 5 s, interval < 30 s, no hysteresis on a hardware rule) show while
    typing and in the checks, and never block a save.
  - In tabs, steps, rows and the Checks card, a blocking problem is red (a count or ✕) and a safety
    warning is the amber circled "!"; never red for something that only warns.
- Saving keeps you on the rule; a new rule opens on its own page.
- **Form / Ladder** is remembered per user; Ladder is tagged "expert".
- A dismissible "Three steps to a rule" tip appears on first use.

### 9.3 Editable sentence, conditions and actions

- The rule is summarised as one sentence at the top, e.g. "When **temperature on bay1-climate is
  above 27 °C** for **10 s**, **turn fan1 on**…".
- **Every phrase is a chip.** Clicking one opens a small editor with Apply / Cancel: a popover beside
  the chip, or a **bottom sheet on phones**.
  - Readings: operator and value.
  - Actuators: On / Off.
  - Everything else: "Open full condition", which opens that condition's item sheet.
- Chips are keyboard-focusable. Esc closes the editor and returns focus to the chip.
- **Conditions** are Line rows inside **All of** (and) / **Any of** (or) groups, which nest. A row
  reads as a phrase ("temperature on bay1-climate > 27 °C, hysteresis 1 °C") and opens its item
  sheet: device, reading, operator, value(s), hysteresis. A group's header switches All / Any and
  has its own sheet (wrap in a group, ungroup, delete). **Add condition** and **Add an Any-of
  group** sit under each group.
- **Actions** and **clear actions** are Line rows too ("Turn fan1 on · bay1-climate"), each opening
  its sheet (type, target, value, message). Clear actions sit under their Switch ("Turn it back when
  the condition clears", "Send a notification when it clears").

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
- The wording follows what the rule acts on: with an actuator the timers "stop hardware flapping"
  and a low value warns that relays cycle; with only notifications, emails or webhooks they "stop
  repeat alerts" and a low value warns of an alert per noisy reading. Same limits either way.
- A rule **not on a reading** (schedule, manual, device online / offline) has only the minimum
  interval: it has **no Behaviour tab or step**, and the interval sits at the end of **Then**.
  A link to its Behaviour tab opens Then.
- **Name and Status** (the rule page's Basics tab, the Review step of the wizard):
  - Rule name, with an auto-generated placeholder ("Left blank, a name is generated").
  - **Status** beside the name (below it on narrow screens): a Switch with **Enabled / Disabled**
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
- The status filter (with Failed deliveries) and the List / Ladder view: §6.

### 9.10 Ladder (expert)

- The **same rule and the same item sheets** as the Form: clicking a contact opens its condition's
  sheet, a coil its action's sheet, a timer the Behaviour tab. There is no separate inspector.
- **Horizontal** rung when it fits the content width; a **vertical** rung on narrow screens (contacts
  top to bottom, groups indented with a dashed rail), so it never scrolls sideways.
- It draws what the Form says in words: the **clear rung** (clear actions, under its own caption),
  the **hold** and **clear-delay** timers (TON), the **minimum interval**, and **latch** with its
  reset. Add points (+) add a contact in series or an OR branch, under one contact or around the
  whole block.
- Every element is focusable; the **arrow keys** move between them along the rung and **Enter**
  opens one. Errors colour the element red, as in the Form.
- A legend under the rung names the symbols.

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

### 10.1 Get started (first run)

- **Who and when:** an owner or admin of a workspace whose setup isn't finished lands on
  `/start` after signing in (§4 Landing), until the four steps are done or someone picks **I'll set
  it up myself** (workspace-wide). Afterwards it stays reachable from Workspace settings → **Setup
  guide**. A viewer opening it sees "Your workspace is being set up", never a checklist they can't
  act on.
- **Steps**, one Line row each, read from data (never ticked by hand, so deleting the only device
  reopens its step): **Create a device template · Connect a device** (done once it sends a
  reading) **· Create a rule · Make a dashboard**, then under **Optional**, **Invite your team**,
  which never holds back "done".
- Each row: a numbered circle (a ✓ once done; the next step in accent with the 3 px accent bar),
  the title, one sentence, or what it's waiting for ("Needs a connected device") in its place, and
  one button that opens the real page (the next step's is primary; a done step's says **Open**).
  Rows waiting on an earlier step stay clickable.
- **Live finish:** once a device has reported, its row shows the latest reading ("bay1 ·
  temperature 24.1, just now"). The rule step opens the recipes with that device (`?device=`).
- **Done:** a "Setup complete" callout with **Open your dashboard**; sign-in lands there from then on.
- The dashboard step also offers **Or build one from my devices** (§10.2) once a device reports.

### 10.2 Welcome (new to a workspace)

- **Who and when:** once, for someone with no dashboard in this workspace who hasn't answered it
  yet (usually just invited; also an owner who dismissed Get started before making one).
- **Content:** "Welcome to {workspace}", "You're in as {Role}.", then what's here as one line of
  facts ("3 devices · 0 rules · 2 alerts need attention"). A viewer in an unfinished workspace
  also sees an info callout "Your workspace is being set up".
- **Your own dashboard** card: **Build my dashboard** (primary) makes "{Workspace} overview", a
  trend chart of each device's first numeric reading, else its status card, two per row, up to 8
  devices, and sets it as their default (§8); **Look around first** goes to Devices. Either answer
  ends the Welcome. With no devices yet there's nothing to chart, so only Look around first shows.

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
  | What a template gives a device | **Metrics** and **Actuators** (never "Readings / Switches") |

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
- **Hit targets:** at least 36 px; on touch (`pointer: coarse`) buttons and inputs are 44 px and
  segmented controls 44 px. Smaller visuals (row checkboxes, inline links, the pager) get a 44 px
  hit area without growing.
- **Widths.** Designed and tested at **1440 · 1366 · 1280 · 1150 · 820 · 390** px. The shell follows
  the window; everything inside follows the **content column's** width (container queries), so a
  pinned-open sidebar or a sheet never breaks the layout under it.

  | Breakpoint | What changes |
  |---|---|
  | window ≥ 1440 | Full sidebar (§4). |
  | window ≤ 640 | Top bar + bottom tab bar; sheets open from the bottom where §5 says so. |
  | content ≥ 1080 | The rule preview sits beside the editor (§9.2). |
  | window ≤ 960 | List toolbar filter menus collapse into one **Filters** button (a bottom sheet), so the primary action stays in row 1. |
  | content ≤ 860 | P3 columns fold. |
  | content ≤ 720 | P2 columns fold; 3–4 column grids become 2. |
  | content ≤ 640 | Wizard steps become "Step n of N"; dashboard edit becomes a list. |
  | content ≤ 600 | Tables become cards; the sentence tightens; the ladder goes vertical if it doesn't fit. |
  | content ≤ 480 | Form grids become one column; save-bar buttons fill the width. |
- **Phone:**
  - At 390 px nothing scrolls horizontally, the ladder included.
  - Demo controls, floating buttons and decorative animation never cover content (the sign-in
    animation sits below its text), and the tab bar respects the safe area.
- **Motion:** honour `prefers-reduced-motion`. Keep transitions under 200 ms and only on
  colour/opacity/transform.
- **Contrast:** meet WCAG AA in both themes. Never fade text with opacity: an inactive row (revoked, disabled) uses the muted text colour and its status word (`DataTable inactive`). Red text on a fill uses `status-error-strong`.
- **Inline links:** a link inside running text (a hint, a sentence) is underlined (`link-inline`); stand-alone links underline on hover.

---

## 13. Functionality that needs backend work

G and H are not frontend-only. These need API, schema or migration work, each respecting CLAUDE.md §9:

| Feature | Backend need |
|---|---|
| Zones | New `zones` table with `tenant_id` + RLS policy in the same migration; nullable `devices.zone_id` FK; CRUD + device count; block delete while assigned. |
| Rule versions + Restore | Versions table (rule snapshot, author, time, change lines) with `tenant_id` + RLS; list endpoint. Restore = client loads the snapshot into the draft, then a normal save. |
| 24 h replay, mini strips, "fired N×" | Firing history endpoint; replay evaluates the rule over **rollups** (continuous aggregates), outside the worker, never on the hot path. |
| Dry run | Endpoint that evaluates the draft against the latest cached readings and returns the outcome. **Sends nothing.** |
| Conflicts ("shares fan1") | Query over enabled rules by device + actuator (can be computed client-side from the rules list). |
| Blocked delete / rename warnings | Usage counts: templates→devices, keys→rules/widgets, zones→devices. |
| Recipes, schedule picker, time zone labels, status switch | **No backend change.** Cron + IANA tz and `enabled` are already stored. |
| CRUD fixes | The P0/P1 items from the redesign audit (now in git history): key freeze, owner-role escalation, disabled templates usable, key format validation, orphaning renames, dropped 422 details. |

**Demo H additions, not built yet.** The UI for each waits for its backend (§1); the frontend
interim is in the last column.

| Feature | Backend need | Until then |
|---|---|---|
| Alarm lifecycle | Stored state on each notification (active / acknowledged / cleared), acknowledge with who, when and a note (one or many), grouping of repeats by source, and a timeline per alarm (an events table with `tenant_id` + RLS in the same migration). A rule's clear marks its alarm cleared. | Notifications grouped and paged by the API, filters, a detail sheet; counts are unread alerts by type. |
| Stored "No response" | A sweep off the hot path that marks each command whose TTL ran out with no ack, so the result is stored and the same for everyone. | The browser works it out from `issued_at`, `ttl` and `acked_at`. |
| Widget titles | An optional `title` on each dashboard widget. | The generated title (reading · device). |
| Reported actuator state | Devices report their real state and whether a command was applied: an additive change to the device contract (CLAUDE.md §4), made in both deployment variants, plus firmware. **Deferred by decision (2026-10-20).** | Requested state and Acknowledged / No response only. |

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

Steps 1–8 are built. **Demo H** follows, frontend first, one PR each:

1. **Shell** (§4): icon rail, full sidebar from 1440 px, phone top bar + tab bar + More sheet,
   reconnecting banner, skip link; bottom Sheet placement.
2. **Building blocks** (§5): Wizard, Line row, item sheet, Tabs with problem badges.
3. **Lists** (§6): column folding, cards, the filter sheet; the Rules list KPI filters and Ladder view.
4. **Templates and Add device** (§8): wizard to create, tabs to edit, item sheets.
5. **Connect** (§8): the connect wizard, which always starts by creating or rotating the credential.
6. **Rule editing** (§9.2–9.3): tabs, condition and action rows, preview beside or in a sheet.
7. **New rule wizard** (§9.1).
8. **Ladder** (§9.10).
9. **Dashboard editing** (§8).
10. **Controls** (§8).
11. **Notifications** (§8), the frontend part.

The §13 "Demo H additions" follow as their own backend work.

---

## 15. Reference and changelog

**Reference demos** (open locally in a browser; no build needed):
- `docs/design/redesign/demo-h-guided.html`: **the reference** for the shell, responsive layout and
  every flow it shows. Overview and things to try: `docs/design/redesign/index.html`.
  - The bar at the top sets the frame width (1440 · 1366 · 1280 · 1150 · 820 · 390), switches light
    and dark, and simulates a lost live connection.
  - Generated from `docs/design/redesign/src/` by `build.sh`; edit the sources.
- `docs/design/redesign/demo-g-full-site.html`: the reference for what H doesn't show.
  - Use the **Demo controls** button (top right) to switch role and theme and to open any route.
  - Hash routes deep-link to pages and editors.

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
| 2026-10-06 | §9.2 Checks card: a safety check that isn't met (hold < 5 s, interval < 30 s, no hysteresis on a hardware rule) shows the **amber circled "!"**, the rail's warning mark, instead of the red ✕, which is kept for problems that block saving (incomplete conditions or actions). Screen readers hear "warning" or "needs fixing". |
| 2026-10-07 | Docs cleanup: demos A–F, the two rule-editor demos and the redesign audit (`redesign-report.html`) are removed; their outcomes are built and written into this file, and the files stay in git history. **Demo G is the only reference demo left.** |
| 2026-10-08 | §5 **Trend chart**: a **1m** range joins 10m · 1h · 6h · 24h · 7d (charts still open on 10m). On every range the time axis is pinned to the full window and slides live instead of fitting to the data; drag-zoom pauses it, double-click resumes. An empty window keeps the chart frame with "No readings in the last {range}" instead of the empty-state card. Same on the device page and in dashboard widgets. |
| 2026-10-13 | §8 connect flow: wired devices **Install** from the browser (generic firmware over Web Serial) instead of downloading a sketch. Step 3 becomes Install, Options shows the wiring, a first install erases saved Wi-Fi, and the sketch moves under Advanced. Every device gets an editable **Broker host** that refuses `localhost`, which a board can't reach. |
| 2026-10-13 | §8 Wiring: **Board** picks a board model (30-pin / 38-pin ESP32 DevKit, ESP32-C3 Super Mini), listed by the firmware release (`firmware/boards.json`), replacing the two chip choices. Pins show their printed label; changing the board flags pins it lacks instead of clearing the wiring. |
| 2026-10-12 | §8 device templates gain a **Wiring** section for the generic firmware (browser install, no code): board, input/output cards built from the firmware's driver catalog, and a wiring guide. Cards reuse the metric/actuator card shape; bool params use the Switch with On / Off. New bindings start on the board's boot-quiet output pins, as the sketch does. |
| 2026-10-12 | §5 **Trend chart**: a number's line gets a faint `--color-chart` gradient fill under it, fading to transparent at the plot's bottom (the on/off wash is unchanged). Reading markers (circles) are dropped everywhere; they used to show on sparse series and cluttered dense ones. |
| 2026-10-15 | §8 Wiring cards: fixed block order **Driver → Connection → Settings → Readings / Commands**; an I2C part's address moves to Connection. Channels are inline Fields (§5 Field gains `inline`), so a 10-reading driver (MPU6050) scans as a list. Metric and actuator pickers offer only rows no other channel holds. |
| 2026-10-15 | §8 connect flow **Options**: the provisioning security choice is removed; phone setup always uses **Security 1 – PoP**. Security 2 (SRP6a) can't work with the firmware's `network_provisioning` 1.0.2 (the app's Wi-Fi list stays empty), so it isn't offered until that is fixed (docs/ble-provisioning.md). |
| 2026-10-15 | §5 **ProgressBar** (NEW) for the device **Install**: stage in words, a determinate bar while writing (overall %) and a sliding one otherwise, the elapsed time, and a "Slower link" note when the board dropped to a lower speed. §8 Options: "Set up from a phone" names **Security 1 (PoP)**, as the QR card does. |
| 2026-10-17 | §8 **Defining a device**: one model for templates and onboarding. **Runs on** (Our firmware / My own code or a gateway) is stored on the template and sets the section order (Wiring second for Our firmware, absent otherwise), replacing "Wiring optional, last in the rail". Metrics are the record that lasts: **Replace part** keeps a reading's metric, removing a part names the rules and dashboards on its keys. Readings are named on the part card with a **What you'll see** line; parts with many readings pick which to keep, and wired parts collapse to one line. Unfed metrics are tagged **Not wired**. Wiring's one home is the template; a device's own wiring uses the same section, tagged **Own wiring**. The board list groups models by chip with capability tags and a **Detect my board** button, and offers only the drivers that board's firmware carries. **Add device** starts as *Same as a device I have* or *Something new*; templates surface on reuse (Add another like this, "Matches *X*. Use it?"). Install on a board without BLE offers only **Type it in**. |
| 2026-10-19 | §8 wording: Add device's first start is **From a template** (was "Same as a device I have": it picks a template, and a workspace can have templates and no devices yet). The second Runs on choice is **Custom firmware or gateway** (was "My own code or a gateway"), still naming gateways and edge connectors, which aren't firmware. |
| 2026-10-19 | §8 wording: the second Runs on choice is **Custom firmware** (was "Custom firmware or gateway"). Gateways still work through it (any client speaking the device contract), but the label stops promising gateway support that isn't built: no gateway connect path, no child devices under one gateway, no connector of ours. SCOPE.md §3 keeps what gateway support needs; the label names gateways again when it lands. |
| 2026-10-20 | **Demo H (Guided)** adopted, frontend first (user decision); G stays the reference where H is silent. §4 shell: icon rail with tooltips and a pin from 641 px, the full sidebar from 1440 px, and on phones a top bar plus a bottom tab bar (Dashboards · Devices · Alerts · Rules · More) replacing the drawer; reconnecting banner and skip link. §5: bottom Sheet placement, **Wizard**, **Line row**, tabs with problem badges. §6: columns fold by priority, cards at 600 px, a Filters sheet on phones; the Rules list KPIs become filters, plus a Ladder view. §7: **create = wizard, edit = tabs, one child item at a time in a sheet**. This replaces the section rail and partly reverses "no editable side panel" (2026-10-02): a sheet still never edits a whole record, it edits one item of the page's draft with Done and no save of its own, and peeks stay read-only. §8: template steps Basics → Hardware → Data → Review and tabs General · Wiring · Data; Add device's Something new is that wizard; the Connect wizard, whose one-time credential now survives a reload in `sessionStorage` until "I've stored it" (replacing "carried over in memory, nothing stored"); controls with a TTL countdown and No response / Retry, plus a command timeline; a dashboard widget sheet, Add a widget in three steps and a phone list (sizes S · M · L · Full replace the width cycle); notifications grouped and filtered. §9.2–9.3: tabs When · If · Then · Behaviour · Activity, with Name, Status and the sentence on top, replace demo A's rail, canvas and inspector (2026-10-03); the preview sits beside the editor from 1160 px, otherwise behind a Preview button; conditions and actions are rows in nested All / Any groups; sentence editors are bottom sheets on phones. §9.1: the new-rule wizard. §9.10 Ladder: the same sheets, a vertical rung when narrow, clear rung, timers, interval and latch drawn, arrow-key focus. §12: tested widths and the breakpoint table. §13: H's backend needs (alarm lifecycle, stored No response, widget titles; reported actuator state deferred) with what the UI shows until then. |
| 2026-10-20 | §8 connect flow, decided while building H: the credential is kept for the whole flow, not just until "I've stored it" (Install, the QR and the sketch need it later), and devices gain `credential_rotated_at` (set on create and rotate, on the device response) so a credential rotated elsewhere is dropped rather than shown. Leaving before storing asks; a reload doesn't. On phones the step list is "Step n of N" over a progress bar. |
| 2026-10-20 | §9.10 ladder, decided while building H: the rung goes vertical when its drawing is wider than its container (measured, not a fixed breakpoint). A read-only rung (the rules list's Ladder view) first scales down to fit and goes vertical only below 55%. Timers read **TON {n}s**; the minimum interval is a label over the coils; the CLEAR rung is *Condition false* → clear-delay TON → the coils that turn back (R) or notify; a latching rule adds a RESET rung (reset by a person). Contacts, blocks and coils open their sheet (with Add in series / in parallel and the Where this sits breadcrumb); the trigger opens the When tab and any timer the Behaviour tab. |
| 2026-10-21 | §8 Add device, matched to demo H after review: the two starts are **radio cards** (new §5 ChoiceCards), not a segmented control. *From a template* is one form — device name and zone, the template grouped by Runs on, an **It gives you** box, **Create device**. *Something new* opens the wizard straight away (no separate "How will this device run?" step): the start cards sit above Basics' question, and **Runs on** is two cards after the names. The page says **Add device** with a description for each start. |
| 2026-10-21 | §8 Connect, matched to demo H after review: a wizard — the shared stepper across the top ("Step n of N" when narrow), each step's content on the page with no card, and the bottom bar holding what the step waits for, Back and Continue; the live check is plain lines with OK / Waiting, and its bar offers Add another like this and Open device. Kept from before, unlike the demo: an **Options** step before Install, because typed-in Wi-Fi and the broker host are written onto the board at Install (the demo's Install-then-Wi-Fi order can't do that); Wi-Fi is a step only when it's set up from a phone; and the steps stay clickable once the password is stored, to skip to Live check for a board that's already installed. |
| 2026-10-21 | §8 device page, matched to demo H after review: the header has a *Template · Zone* overline, a plain title, the status with "last message {ago}", then **Connect** (never connected) or **Install** and the record ⋯ menu (the list row's items, from one shared hook). Edit device is gone; the Settings tab is the way in. Overview: one offline or waiting callout on top, a **Live / Stale / No data** badge on each readout (live for three publish intervals, 30 s when streaming, a day when on change), Trend, and a **Health** card (signal, battery or Mains, firmware, uptime, MQTT id). Controls: offline is said once, above the rows; each actuator is a Line row with *Requested*, what happened, who sent it and an **On \| Off** segmented control (allowed values when not on/off); then **Command timeline** with its filters on the same row. Rules tab: Line rows (name, sentence, state). Settings: plain stacked sections divided by hairlines, Template as a definition list with **Gives it**, Connection as username + Copy / password + Rotate / topics behind a disclosure, **Delete** last. Peek: readings as lines, **Open device** the one button. Kept apart from the demo: commands say "sent manually" (the API doesn't record who); *Device reports* waits for reported state (Phase 2); the peek's ‹ › and ⋯ stay in its header like every other peek; the device's Wiring section stays. Escape in a ⋯ menu now closes only the menu, not the peek or sheet around it. |
| 2026-10-21 | §9.10 ladder, after review: the editor's rung also **scales down to fit** before it goes vertical, as the read-only one does, but only to 80% (its smallest text stays about 8.5 px, legible enough to edit); below that it goes vertical. A rule with a few nested groups now stays a diagram on a laptop-width window instead of turning into the vertical list. |
| 2026-10-22 | §9 rules, matched to demo H after review. **List:** columns Rule · Trigger · Action · State · ⋯; the last 24 hours (strip and "fired N×", or the schedule) and *shares* / *can't evaluate* tags sit under the rule's name; Trigger says what starts it ("On each reading"); actions read "Post a notification", "Email the alert recipients"; the row ⋯ is Open, Run now…, Reset latch… (when latched), Duplicate, Enable/Disable, Delete… (one shared set with the peek and the rule page). **Rule page:** overline *Rule · state · fired N× in 24 h*, **Run now…** and ⋯ in the header (no Duplicate button, no ✕); latched and can't-evaluate callouts; **Name** with "Left blank, a name is generated"; **Save rule**, with "Save and apply now?" for an enabled rule. **When:** four radio cards. **If:** "All \| Any of these must be true", rows per condition with *and*/*or* between, nested groups dashed with Remove group, Condition / Any-of group buttons, an empty card with Add condition. **Then:** actions as sentences ("Turn Fan on"), one **Add action** menu (WhatsApp and Push, never built, are gone), and a "When it clears … Change in Behaviour" line. **Behaviour:** Re-arm / Latch as illustrated radio cards, then "Safety — always applied" with Hold time, Minimum interval and Clear delay three across (in seconds, off where they don't apply), then Notify when it clears. **Activity:** a wide "Last 24 hours" strip, Recent firings as rows with ✓ / ⚠ per action, Versions as "Version N · current". **New rule:** title New rule, recipes the device can't run shown disabled with what they need, Start blank "When, If, Then, step by step.", save bar "Not created yet". **Preview:** "Other rules on these actuators" only when there are some. Kept: the rule peek, the Failed deliveries tab, Try other values, and the preview column starting at the tabs. |
| 2026-10-22 | §8 templates and §6 zones, matched to demo H after review. **Templates list:** the name's sub-line says what it runs on (*Our firmware · {board}* / *Custom firmware*); Metrics and Actuators are right-aligned sortable counts, Devices reads "N devices"; the row ⋯ and the template page's ⋯ add **Wiring guide** (and View devices on the page). **Peek:** Runs on, Board and Parts, then *What you'll see*; its button is **Edit**. **Wiring (Hardware step and tab):** the board in its own block with **Detect** and its facts in the hint (phone setup or typed Wi-Fi, RGB LED, firmware version); one **Parts** list with a count and **Add part**, which opens a picker grouped *Sensors and inputs* / *Outputs* (replacing Add input / Add output); a part's line is "pins · what it feeds" or "no readings kept"; *What you'll see* lists Metrics and Actuators. **Wiring guide** is its own printable page, `/templates/{id}/wiring` (Part · Connection · Board pin, then Notes), linked from Parts; a device's own wiring, or a template not saved yet, keeps the guide in the editor, folded. **Data:** demo leads; the metric sheet uses segmented controls (Number \| On / Off; Every… \| On change \| Streaming) with publishing and range folded under "Publishing and range · {summary}"; the actuator sheet's Control is a segmented control and its payloads are folded under "Payloads". The Review step's problems are a red callout. **Zones:** "Places your devices live in.", *All reporting* / *N offline*, "No notes", "N devices"; the zone page says how many devices are in it and that devices are moved from their own settings. Kept: Legacy tag, Updated column, Set up / Remove wiring, the I2C bus and moved-pin callouts, editable Runs on. |
| 2026-10-22 | §8 dashboards and notifications, matched to demo H after review. **Dashboard view:** a "Dashboards" breadcrumb, "N widgets · live", and a header **range** (1m · 10m · 1h · 6h · 24h · 7d, when the dashboard has a trend) that every trend widget follows, so trend widgets lose their own range buttons (the device page's chart keeps its own). **Widgets:** one bold title, *Reading · Device* (device status and controls: the device's name), the device a link; a value card's foot is "Stale · last value {ago}" or "No data"; a gauge shows its unit beside the value and "lo–hi unit" under it. Edit callout: "Click a widget to change what it shows and its size…". **Notifications:** a severity row (Critical, unread · Warnings, unread · Unread) that filters, the device, rule and template as links in each row's last line and in the sheet (the Open device / rule / template buttons go), the demo's description, and "Nothing needs attention" when empty. Until alarms have a lifecycle (§13), *unread* stands in for the demo's *active / not acknowledged*, and widget titles are worked out in the browser rather than stored. |
| 2026-10-22 | §7 admin pages and §4 shell, matched to demo H after review. A full-page editor's title is the page's **H1** (a drawer's stays a section heading). **Workspace settings:** one plain stacked page (new EditorFrame nav `plain`: no rail, no jump bar), sections Workspace · Alerts · Time and region · You · **Leave workspace** (a danger section with "Leave workspace…"), save **Save**; the recipient chips and the time-zone lead stay (2026-09-30). **Members:** "People in this workspace and what they can do.", **Invite**. **Invite:** "Invite a member", "They get an email with a link that works for 7 days.", Email and Role side by side (Role a segmented control, Owner only for owners), the demo's role hints, toast "{email} has 7 days to accept.", the breadcrumb without the current page. **API keys:** "For scripts and other systems: Authorization: Bearer.", **New key**, "Created {date}" under the name, column **Scope**. **New key:** title "New API key", Name "What uses it, e.g. Grafana." beside Expires ("In a year"), **Scope** Viewer \| Admin with the Admin warning; the secret dialog is "Copy your key" / "It won't be shown again." **Sign in:** "to your workspace", "No account? Create a workspace". **Palette:** "Search or run…", "No matches", one *Actions* group (creating and the theme), and before typing a few devices and rules after *Go to*. The sidebar's nav is named **Main**. |
| 2026-10-23 | §3 type, after review: Geist and Geist Mono are **self-hosted** (`app/fonts`, SIL OFL 1.1, latin, variable 100–900) through `next/font/local`. `next/font/google` fell back to system fonts for a dev server's whole life whenever it started without network, which made the app look bigger and wider than demo H. Page titles are 28 px (24 px on phones) and dot / text badges 12.5 px medium, as in demo H. The devices list shows the name in the UI face with its MQTT id under it in mono. |
| 2026-10-23 | §7 save bar and §5 field rows, after review. The save bar is **always at the bottom of the window**, short pages included (demo H): `<main>` fills the window and a page that owns a bar grows to it (`PAGE_WITH_BAR` / `SAVE_BAR` in `components/editor/save-bar.ts`, used by EditorFrame, the rule editor, Add device and the Connect wizard; the device Settings tab's floating bar lands there too). Toasts rise above any save bar. **Controls in a row line up at the top**: a Field never stretches to its tallest neighbour, so a hint or error under one field no longer moves or grows the next control. |
| 2026-10-23 | §8 notifications, after review (too much empty space): rows follow demo H's alarm row — a bare 17 px severity icon, one column with the bold title (×N), the detail in muted 12.5 px and a small meta line (time, then device / rule / template links), and on the right the state and its action: an **Unread** pill and **Mark read** / **Mark unread**, then ⋯ (Dismiss). Unread rows carry the 3 px accent bar on their left edge instead of a tinted background; the chevron goes (the whole row opens the sheet); the list has no shadow. On phones the right group wraps under the text. The footer counts against all alerts. |
| 2026-10-24 | §6 pagination, after review: every list that can grow pages at 25 / 50 / 100 with the one footer (`TableFooter`; below 25 rows it shows only the count). **History is paged by the API** (limit / offset, total in `X-Total-Count`), so all of it can be browsed, not only the latest 50–100: the command timeline (its Result and Actuator filters now apply on the server), a rule's Recent firings and Versions, and Failed deliveries (`components/list/useServerPager.ts`; page state per list, not in the URL, so two lists on one page don't clash; realtime refreshes every loaded page). The device Rules tab and the rules Ladder view page in the browser (`usePager`, and the list's own URL paging). **Notifications** load the latest 100 and **Show older** adds 100 at a time, up to 500, so grouping repeats, the filters and read / unread keep working over everything shown. Lists bounded by design never page: a dashboard's widgets, a template's metrics and actuators, a device's readings and health, rule conditions and actions, the Add part picker, the command palette. |
| 2026-10-26 | §5, §6 list pages, from the user's sketch and demo K option B (`redesign/demo-k-list-header.html`): the description sits **beside the title**; the **primary action** moves to the end of the toolbar's first row (the header keeps it only while there's no toolbar: loading, error, first use); the **KPI strip leaves list pages** for a **status filter with counts** on the toolbar's second row, with dots, a red count for states that need someone, and hover titles for what each state means. On phones it becomes a select. Every list with states gets one (Dashboards has none). The KPI strip stays only on the alerts inbox. Table starts about 100 px higher on Devices at 1440. |
| 2026-10-26 | §6, §8, after #167: **Notifications** take the same toolbar: the description beside the title, **Mark all as read** at the end of row 1, and the KPI strip becomes the status filter All · Unread · Critical · Warning (Critical and Warning count unread alerts, in red). **Rules lose their tabs:** Failed deliveries is the last state of the status filter, counting deliveries; choosing it shows the delivery feed in place of the table. `/rules/failed-actions` redirects there. The KPI strip is retired. |
| 2026-10-27 | §4, §5, §6, §7, §9.2, §11 **one editor pattern**, from a review of the device Settings tab (the best-composed editor) against every other new / edit / settings page. **Column:** every editor, wizard and settings page is 760 px inside the 1120 px page, the rule editor included (it leaves the 1520 px wide view); the rule **preview is only behind its Preview button** (a sheet), at every width. **No title said twice:** breadcrumbs list parents only, the overline carries status and meta only (no record kind), a section heading never repeats the record kind, tab or step question, and a single-section page has none. **Sections** are hairline-divided with a one-line lead, no cards. **Fields:** the "Manage X" link ends the hint; short related fields pair. New **FactList** (read-only facts) and **Inherited** (a value that follows another record's) components. **Save bar**, superseding 2026-10-23: when editing it appears only while there is an edit, a save or a problem; when creating it is always shown. **Delete** is in the record menu only, superseding 2026-10-02's device "Danger zone"; a danger section remains only on pages with no record menu (Leave workspace). **Pager:** numbered pages `‹ 1 2 [3] … 9 ›` (`‹ 3 / 9 ›` on phones). **Lasting states** (can't evaluate, offline) are header state chips, not callouts or toasts; a toast marks a state *changing* while the page is open; a callout stays only when it holds the action. **Wording:** a template gives a device **Metrics** and **Actuators**. |
| 2026-10-27 | §8 Connect, after review: the Credential step **always starts with Create credential / Rotate credential…** — Add device no longer hands its credential over, and the credential is held in the page only (a reload or leaving drops it; leaving or reloading before it's stored asks). Once made, **Store its credential** (demo H): Username and Password as read-only fields with Copy, "It won't be shown again", I've stored it, Continue in the bottom bar. Supersedes the 2026-10-01 handoff and the "survives a reload" rule. |
| 2026-10-27 | §9.1 New rule, after review: **Name first, then the recipe; no device select** (a rule can involve several devices). Every recipe is always offered, device-free, its devices picked in the When / If / Then steps; "Name the rule first." when a recipe is picked without one. From a device page the recipes it can run come first, filled with it. The disabled "can't run" cards go. |
| 2026-10-28 | §3, §4, §5, §7, §8, §12 **interface audit** (iodriven Interface Audit, 28 findings at 1440 → 390 px and dark). **Controls:** two heights only, 36 px and 30 px `sm` buttons; segmented controls and tabs 36 px; a primary is always the 36 px accent button. **Type:** five steps 12 · 13 · 14 · 16 · 28 px through tokens, superseding 14.5 / 14 / 12.5. **Status:** one dot + word badge in tables and previews; roles one style. **Header:** one `PageHeader` for every page, status first in the overline, actions on the H1 row, one action row under the title on phones. **Destructive:** on-page entry points are secondary + red text + “…”; filled red only in dialogs. **Tabs** scroll sideways on phones, superseding “wrap or collapse into a menu”. **Peek:** no record kind, **Open {noun}**, its controls on their own row above the title on phones. **Save bar:** Cancel on create pages, one width, full-width buttons ≤ 480, and the phone tab bar hides while it shows. **Notifications:** unread is the accent bar and a bold title, superseding 2026-10-23's Unread pill and Mark read button. **Toolbar:** filters collapse ≤ 960 px. **Density:** the command timeline folds runs into ×N rows; a dashboard's first row ends with an *Add widget* tile where it has room; the device Overview's Health is a plain FactList of what was reported. |
| 2026-10-28 | Round-2 audit fixes, §7 and §8: a create bar's state line is always **Not created yet** (the template wizard said *Unsaved changes*, New zone *New zone, not created yet*); the dashboard's *Add widget* tile is desktop-only and never reserves space on a phone. |
| 2026-10-28 | §5 one **NotFound** state for every record page (round-2 audit R2): rules showed an error with Retry, zones and templates "Couldn't load…" (templates leaking "Catalog entry not found"), API keys and members a skeleton that never ended. |
| 2026-10-28 | §12 contrast and links (round-2 audit R3, R5): no opacity on text (inactive rows use the muted colour; the "· optional" suffix too), `status-error-strong` for red text on a fill (the destructive button), and `link-inline` underlines links inside sentences. |
| 2026-10-28 | §12 screen-reader structure (round-2 audit R4, R10, R11): an editor with tabs renders its body as the active tab's `tabpanel` and only the selected tab carries `aria-controls`; editor section headings are h2 on a full page (h3 in drawers); landing markup fixed (figures list, comparison table corner cell) and its log timestamps lightened to AA. |
| 2026-10-28 | §5, §7 menus and wizard (round-2 audit R6, R7): a row menu's first item is **Open** on every list (Zones and Templates said Edit / View, Devices Edit settings); a wizard marks only visited steps red. |
| 2026-10-28 | Round-2 leftovers (B2, G4, R12): the trend chart's range is the segmented control (36 px, like the dashboard's); on phones a header whose only action is the ⋯ menu keeps it beside the title; §8 API keys: a revoked or expired key can be **deleted** (*Delete key…*, `DELETE /api-keys/{id}/permanent`); an active key is only ever revoked first. |
| 2026-10-29 | §6, §8 notifications paged like every list: the API groups repeats (`GET /notifications/groups`, filters and limit / offset, total in `X-Total-Count`), so the numbered pager and the ×N counts cover the whole history instead of the latest 100–500 behind **Show older** (removed, with its second footer line). The status filter swaps Critical / Warning for unread alerts by type (Offline, Rules, Rule health, Failed deliveries, Templates; `GET /notifications/summary`); severity stays a filter menu. Counts are alerts (rows of repeats), and the nav badge uses the same count. Read, unread and dismiss act on a whole row (`/notifications/groups/{key}/…`, Undo restores the dismissed ids). "since …" uses the §11 date format instead of the browser's language. |
| 2026-10-29 | §9.1, §9.2, §9.7 rule page and wizard: the rule page's tabs sit right under the header, like a template's. The editable sentence is the header's description, and **Basics** (first tab, the default) holds Name, Status and the consequence line. New rule opens on the recipes without a Name field; the name is asked once, on Review, suggested by the recipe. Behaviour words its timers by what the rule acts on (hardware flapping vs repeat alerts), and a rule not on a reading has no Behaviour tab or step: its minimum interval sits in Then. Recipes stay. |
| 2026-10-29 | §8 default dashboard: **Set as default** / **Remove as default** in the dashboard row menu, peek and page ⋯; a **Default** tag in the list and header; only sign-in uses it, and the nav's Dashboards keeps opening the list. Per person per workspace (`tenant_memberships.default_dashboard_id`, cleared when that dashboard is deleted). First of the landing / onboarding plan. |
| 2026-10-30 | §4 Landing: one decision for where people go after signing in (`/home` + `GET /tenants/current/landing`), used by sign-in, register, invites, "Open console" and switching / creating a workspace; Devices is now the last fallback instead of every entry point. Second of the landing / onboarding plan. |
| 2026-10-30 | §10.1 Get started: `/start` for a new workspace's owners and admins (four steps read from data plus an optional invite, the next one highlighted, a live first reading, "I'll set it up myself" for the whole workspace, a Setup guide link in Workspace settings; viewers see "being set up"). Third of the landing / onboarding plan. |
| 2026-10-30 | §10.2 Welcome: a one-time `/welcome` for someone with no dashboard in the workspace (facts, a "being set up" note for viewers, **Build my dashboard**: a starter dashboard from the devices set as their default, or **Look around first**); Get started's dashboard step offers the same build. `POST /tenants/current/welcome`. Fourth of the landing / onboarding plan. |
| 2026-10-30 | §8 attention strip above every dashboard: unread critical alerts, offline devices, latched rules and rules that can't evaluate, only when non-zero, each linking to its filtered list (`GET /tenants/current/attention`). Last of the landing / onboarding plan. |
