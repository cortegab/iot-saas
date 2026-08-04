# iot-saas UI/UX Design Brief

This document covers **interface and experience only** — what the user sees, how it behaves, and why.
System architecture, data model, and delivery phasing are out of scope here and live in `CLAUDE.md`
and `PLAN.md`.

---

## Who this is for

A maker or small-operation owner who:

- Just bought an ESP32 and wants to see a temperature reading on a chart **today**
- Checks in periodically — a few times a day — not for eight-hour shifts
- Runs a handful of devices, not a fleet
- Is technical enough to flash firmware, but is not a control-systems engineer
- Will abandon the product in the first ten minutes if nothing shows up on screen

Every screen should quickly answer:

- Is my device connected and sending data?
- What are my readings doing right now?
- Did anything cross a threshold?
- Did my actuator actually fire?

If a new user cannot get from signup to a live reading without reading documentation, the onboarding
flow needs redesigning. That is the single most important measure in this document.

---

## Design principles

- **Dark mode first**, light mode fully supported
- **Moderate information density** — readable, not a wall of numbers, and not oversized cards either
- Low cognitive load, minimal clicks, predictable interactions
- **Semantic color only** — color carries status; it is not decoration
- Subtle motion, under 200ms
- **Streaming-first** — data arrives on its own; the user never refreshes to see current values
- **Honest about the unknown** — missing data, disconnection, and limits are stated plainly rather
  than papered over

Never optimize for aesthetics before usability. Never let visual polish delay time-to-first-data.

---

## Information architecture

Primary navigation, in priority order:

1. **Devices** — the default destination for a returning user
2. **Dashboards** — user-composed views
3. **Rules** — automation
4. **Settings** — account, plan, credentials

Secondary: search, and account/workspace switching.

Nothing else earns a top-level slot. Every additional item costs clarity for a user who has three
devices.

---

## Screens

### 1. Onboarding — the primary flow

**This is the product's competitive advantage and therefore the most important screen sequence.**

Path: create account → create device → copy generated firmware → paste Wi-Fi credentials → see live
data. Target: **under 10 minutes**, no documentation required.

- The device-creation step presents a **ready-to-paste sketch with credentials already filled in**
- A copy button with obvious affordance; the code block is the hero element, not an afterthought
- A **live "waiting for first message" state** that visibly reacts the instant data arrives — this is
  the product's payoff moment and should feel like one
- Friendly troubleshooting **inline** ("No data yet? Check the board is on the same Wi-Fi…"), not a
  link to docs
- The device credential is shown **once** — make that consequence obvious *before* the user navigates
  away

### 2. Device list

Per device: name, connection state, and current value(s) of key metrics.

Comfortable at a handful of devices; must stay usable at several hundred. Connection state is the
most scannable element on the row — a user should be able to spot a disconnected device without
reading.

### 3. Device detail

In priority order:

1. **Connection state** — the first thing a user needs to know, because nothing else on the page is
   trustworthy if the device is offline
2. **Current readings** — latest value per metric
3. **Trend chart** — the main content of the page
4. **Rules attached to this device**
5. **Actuator controls** and recent command history
6. Settings, credential rotation, destructive actions — last, and visually separated

**Only render measurements the device actually reports.** If a device has never sent a battery or
signal reading, show nothing — never an empty gauge or a zero. A placeholder that implies a
measurement exists is worse than an absence.

### 4. Charts

Charts are the core of the product. Invest here.

- Zoom, pan, crosshair, hover readout
- Time-range selector, with the selected range always visible
- Threshold markers drawn from the device's rules
- Multiple metrics on shared or split axes
- A clear "no data in this range" state

Charts must stay responsive at every range. When the view shows aggregated rather than
per-reading data, **say so** — quietly, but discoverably. A user comparing two ranges should never be
misled about what a point represents.

### 5. Dashboards

Users compose their own views from widgets: value cards, live charts, gauges, device status, and
actuator controls.

- Drag to arrange, resizable widgets, saved per user
- An empty dashboard guides the user to their first widget rather than presenting a blank canvas
- Widgets degrade gracefully when their device goes offline or their metric stops reporting

### 6. Rule builder

A **form-based builder, not a node graph**. A rule watches one metric and fires one action, so the UI
should be equally direct.

**Organise the form around the rule's condition type.** Threshold comparison is the type available
today; the layout must allow another condition type to replace those fields later without redesigning
the surrounding form, summary, or validation.

**Cover every action type** the platform offers — device command, notification, and outbound webhook.
Each needs its own editor, and the summary must read naturally for all of them.

Every rule renders as a **plain-language summary** the user can verify at a glance:

> "When **temperature** stays above **40 °C** for **30 seconds**, turn **Fan 1 ON**."
>
> "When **humidity** drops below **20 %** for **1 minute**, **send a notification**."

Three fields protect real hardware from a rule that would cycle a relay to death on noisy readings.
Present them in plain language, never in jargon:

| Field | Present it as |
|---|---|
| Hold time | "Ignore brief spikes — the condition must hold this long" |
| Re-arm gap | "How far the value must fall back before this can fire again" |
| Minimum interval | "Shortest time allowed between firings" |

**The UI must never offer a path that bypasses these**, and their defaults must be safe rather than
zero. This is a hardware-safety requirement, not a preference.

A rule can be **disabled without being deleted** — make that state unmistakable in both the builder
and any list of rules.

### 7. Actuator control

Manual control lives on the device page and can be placed on dashboards.

- Current state always visible, with the **requested vs. confirmed** distinction clear
- Confirmation for anything consequential
- **Honest offline behaviour** — if the device is not connected, the UI says the change is pending and
  will apply when it reconnects. Never render that as success
- Command history with timestamps and confirmation status

### 8. Account and plan

Plan limits are part of the product surface, not a settings-page afterthought.

- Show usage against limits **where the limit will be felt** — the device list, the dashboard list,
  the chart's time range
- When a request exceeds the plan, explain it in place and offer the upgrade there. Never silently
  truncate a chart or drop a row
- Upgrade prompts appear at the moment of friction, and nowhere else

---

## Live data

New values animate in subtly rather than snapping. The UI must stay readable no matter how fast
readings arrive — a chart or list repainting faster than a person can read it is worse than one
updating a few times a second.

**Connection state must be visible** — connected, reconnecting, or disconnected. A stale view that
looks live is the worst possible failure, because the user acts on it.

---

## Tables

Used for devices, rules, and command history.

- Sorting, filtering, resizable columns
- Keyboard navigation
- Export where the plan allows it
- Empty states that suggest the next action rather than saying "no data"

---

## States

Every screen specifies all five:

- **Empty** — new account, no devices, no data in range. Always suggests the next action
- **Loading** — skeletons matching the final layout; no layout shift when content lands
- **Error** — what failed, and what the user can do about it
- **Offline** — device disconnected vs. browser disconnected, visually distinct from each other
- **Unknown** — a metric the device has never reported. Absent, not zero

---

## Accessibility

- WCAG AA contrast in both themes
- Full keyboard navigation with visible focus states
- Screen-reader labels on all status indicators and controls
- **Color-blind safe** — status is never conveyed by color alone; pair it with an icon, shape, or
  text label

---

## Motion

- Under 200ms, easing out
- Motion communicates change (a new reading, a state transition) — never decoration
- Respect `prefers-reduced-motion`

---

## Required output per screen

1. UX rationale
2. Layout hierarchy
3. Component inventory
4. Information priority
5. User flow
6. Responsive behavior
7. Empty / loading / error / offline / unknown states
8. Accessibility notes
9. Performance considerations
10. Motion guidelines
11. Design tokens
12. Reusable components

---

## Recommendations

**1. Onboarding is the product.** More design effort belongs in the first ten minutes than in any
dashboard widget.

**2. Make live data the default experience.** Streaming updates with subtle motion; never require a
manual refresh.

**3. Treat charts as first-class.** They are the main thing users look at. Invest in interaction
quality and be honest about what a plotted point represents.

**4. Be honest about what is unknown.** Disconnection, missing metrics, and plan limits stated plainly.
Fabricated completeness erodes trust faster than a visible gap.

**5. Make rule safety legible.** Hold time, re-arm gap, and minimum interval protect real hardware.
Explain them in plain language and put the summary where it cannot be missed before saving.

**6. Design for the smallest account.** Most users will have very few devices. That experience should
feel complete, not like a crippled demo.

**7. Build a small, consistent design system.** Tokens and a modest component set — enough for
consistency, not a framework project of its own.

**8. Keyboard shortcuts where they earn their place.** Navigation and search shortcuts are welcome; a
full command palette is not a priority for users who visit a few times a day.
