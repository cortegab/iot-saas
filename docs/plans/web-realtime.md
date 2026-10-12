# Web realtime under high-rate telemetry

Devices publishing several times a second made the web dashboard slow and sometimes froze it
(first seen on a prod device publishing a few readings per second). This is the audit of the
live-updates path, the changes made, and before/after numbers.

## 1. Audit — how live data reaches the browser

**Transport.** A backend WebSocket gateway, not MQTT-over-WS. The worker's ingestion call
(`ingestion.service.record_telemetry_direct`) does `XADD telemetry` for the batched writer and
`PUBLISH realtime:{tenant_id}` with one JSON event per reading. The API's `/ws` endpoint
(`realtime/router.py`) subscribes each socket to its tenant's channel and relays **every message
as its own frame**, tenant-wide: a tab gets every reading of every device in the tenant, whatever
page it is on.

**React state.** One socket, opened by `useRealtime` (mounted once in the app layout). For each
telemetry frame it called SWR `mutate()` with `revalidate: false` on:
- `/devices/{id}/latest` (`mergeLatest`, a new array whenever the reading is newer),
- `/devices/{id}` (`markOnline`, a new object whenever `last_seen_at` moves, i.e. every message),
- every cached chart key for that device+metric (`appendPoint`), found by scanning all SWR cache
  keys.

The device page subscribes to `/devices/{id}` and `/devices/{id}/latest` at the top, so **the
whole page re-rendered on every reading**. On a dashboard, every widget for the device did.

**Charts.** uPlot (canvas). Live ticks call `setData` rather than rebuilding the plot, which is
right. But each tick also:
- `appendPoint` copied the whole points array;
- `TrendChart`'s `chartData` memo re-parsed **every** ISO timestamp (`new Date(p.time)`) and
  rebuilt both columns;
- uPlot redrew the full series.

So per-reading cost is O(points in window). Points in window grow with rate × window length, which
makes total cost grow with **rate²**: 20 Hz over the default 10m window is 12,000 points, re-parsed
20 times a second, per chart.

**Unbounded growth / hidden tabs.** Chart arrays were trimmed to the window, so memory was bounded.
Nothing paused while the tab was hidden. Every frame was still parsed and applied, and the renders
ran in a burst when the tab came back.

### What the original brief asked for that we did not do

- **Separate horizontally scaled gateway.** The `/ws` gateway already exists, and CLAUDE.md §9.9
  keeps us on one host.
- **`live` topic and `sample_rate`/`publish_rate`/`store_rate` firmware settings.** That is a
  device-contract change (§4, §9.6, both deployment variants). The template's `publish: "streaming"`
  profile already exists. Storage-side downsampling for high-rate devices is a separate follow-up.
- **LTTB for history.** Ranges over 1h already read 1-minute/1-hour rollups.

## 2. Changes

1. **Client-side live buffer** (`frontend/src/lib/live-buffer.ts`). Telemetry frames land in plain
   maps outside React. One flush, at most 4×/s and on an animation frame:
   - applies the newest reading per device to `/devices/{id}/latest` and `/devices/{id}`
     (`markOnline` moves `last_seen_at` only by whole seconds);
   - hands each chart every point since the last flush.

   Frames are dropped while the tab is hidden. When the page is visible again, the device keys are
   revalidated, the same catch-up a WS reconnect does.
2. **TrendChart appends in place.** The series lives in a ref as uPlot columns. It is seeded once
   per fetch, then appended to and trimmed (binary search) per flush, with no React render. It
   redraws once per flush and decimates to min/max per pixel column while following "now". A
   drag-zoom draws every point.
3. **Dashboard charts no longer rebuild on device updates.** The `thresholds = []` default param
   was a new array each render and a plot-rebuild dependency. Profiling showed the uPlot
   constructor as the top JS cost: every `/devices/{id}` update tore down and re-created every
   dashboard chart.
4. **Server-side coalescing** (`realtime/router.py`). Each socket gets at most one frame per
   `REALTIME_FLUSH_INTERVAL_MS` (default 250), shaped `{"type":"batch","events":[…]}`. Every event
   is kept, and a lone event is sent unwrapped. This is UI-only latency: actuation never touches
   `/ws`.

## 3. Measuring

- `backend/scripts/load_publish.py` generates N devices × R Hz through the same ingestion call the
  worker makes (stream + realtime publish; no MQTT, no rules).
- `frontend/e2e/realtime-load.spec.ts` (only with `PERF_REALTIME=1`) creates "Load 01..NN"
  devices plus a dashboard with a trend chart and a value card per device, starts the load, and
  measures the dashboard and then the first device's page. It reports:
  - main-thread CPU (CDP `TaskDuration` over wall time),
  - long tasks (`PerformanceObserver('longtask')`),
  - JS heap, sampled every 15 s,
  - WS frames received per second.

```bash
cd frontend && PERF_REALTIME=1 PERF_MINUTES=5 PERF_WARMUP_S=60 pnpm test:e2e realtime-load
```

The dev stack serves `next dev` (development React), so absolute numbers are pessimistic next to a
production build. Before and after were measured the same way, on the same machine.

## 4. Results — 20 devices × 20 Hz (400 readings/s)

5 minutes per page after a 60 s warmup (`next dev`, same laptop). "Frames/s" counts WS frames the
page actually received. Below 400, the main thread can't keep up and frames back up.

| | Main-thread CPU | Long tasks/min | Longest task | Heap (start → end, max) | WS frames/s |
|---|---|---|---|---|---|
| **Before**: dashboard (20 charts + 20 value cards) | 98.8% | 16.4 | 157 ms | 42 → 46 MB, max 124 | 108 |
| **Before**: device page | 40.8% | 1.8 | 73 ms | 138 → 21 MB | 375 |
| **After 1**: dashboard | 29.7% | 116.8 | 185 ms | 68 → 37 MB, max 74 | 434 |
| **After 1**: device page | 12.5% | 1.6 | 116 ms | 72 → 24 MB | 431 |
| **After 1–3**: device page | 16.6% | 2.6 | 134 ms | 94 → 21 MB | 434 |
| **After 1–4** | *pending: rerun on an idle machine* | | | | |

Reading the "After" rows:
- **After 1:** the page now keeps up with the stream, and CPU fell by two thirds. Long tasks got
  more frequent: each flush redrew 20 charts at once, and every device update rebuilt every chart
  (fixed in 3).
- **After 1–3:** the dashboard run overlapped a stray load script from an earlier run (≈800
  readings/s), so it isn't listed. The device-page run came after the overlap.
- **After 1–4:** the first run coincided with a firmware build on the same machine (load average
  ≈11), which invalidates its long-task numbers. It did confirm the batching: 4.2 frames/s instead
  of 400.

## 5. Follow-ups

- Per-connection device filter (the client sends the device ids it shows). Traffic is
  tenant-wide today, so this matters for large tenants.
- Bucket raw reads for the 1h range when a device publishes fast (`telemetry.service.get_range`).
- Storage-side downsampling for high-rate devices, without touching the device contract.
- The worker logs one INFO line per reading (`telemetry … -> value=…`). At high rates that is
  log volume worth cutting.
