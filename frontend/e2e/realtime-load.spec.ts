import { spawn } from "node:child_process";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

/**
 * Local perf probe for the live-updates path (docs/plans/web-realtime.md),
 * not part of the regular suite: it only runs with PERF_REALTIME=1, takes
 * minutes, and drives load through the dev stack's api container
 * (backend/scripts/load_publish.py).
 *
 *   PERF_REALTIME=1 PERF_MINUTES=5 pnpm test:e2e realtime-load
 *
 * Fixtures are find-or-create and left in place for the next run: a "Load
 * test" template, devices "Load 01".."Load NN" and a "Load test" dashboard
 * with a trend chart and a value card per device.
 */
const ENABLED = process.env.PERF_REALTIME === "1";
const MINUTES = Number(process.env.PERF_MINUTES ?? 5);
const WARMUP_S = Number(process.env.PERF_WARMUP_S ?? 60);
const DEVICES = Number(process.env.PERF_DEVICES ?? 20);
const HZ = Number(process.env.PERF_HZ ?? 20);
const METRIC = "temperature";
const NAME = "Load test";

type Headers = Record<string, string>;
const deviceName = (i: number) => `Load ${String(i).padStart(2, "0")}`;

async function ensureFixtures(request: APIRequestContext, headers: Headers) {
  const entries = (await (await request.get(`${API_URL}/catalog`, { headers })).json()) as { id: string; name: string }[];
  let entry = entries.find((e) => e.name === NAME);
  if (!entry) {
    const res = await request.post(`${API_URL}/catalog`, {
      headers,
      data: {
        name: NAME,
        metrics: [{ name: "Temperature", key: METRIC, unit: "°C", decimals: 1, publish: "streaming" }],
      },
    });
    expect(res.ok(), `POST /catalog: ${res.status()} ${await res.text()}`).toBeTruthy();
    entry = await res.json();
  }

  const existing = (await (await request.get(`${API_URL}/devices`, { headers })).json()) as { id: string; name: string }[];
  const deviceIds: string[] = [];
  for (let i = 1; i <= DEVICES; i++) {
    let device = existing.find((d) => d.name === deviceName(i));
    if (!device) {
      const res = await request.post(`${API_URL}/devices`, {
        headers,
        data: { name: deviceName(i), catalog_entry_id: entry!.id },
      });
      expect(res.ok(), `POST /devices: ${res.status()} ${await res.text()}`).toBeTruthy();
      device = ((await res.json()) as { device: { id: string; name: string } }).device;
    }
    deviceIds.push(device.id);
  }

  const dashboards = (await (await request.get(`${API_URL}/dashboards`, { headers })).json()) as { id: string; name: string }[];
  let dash = dashboards.find((d) => d.name === NAME);
  if (!dash) {
    dash = await (await request.post(`${API_URL}/dashboards`, { headers, data: { name: NAME } })).json();
  }
  // Two devices per 12-column row: a chart (w4) and a value card (w2) each.
  const layout = deviceIds.flatMap((id, i) => {
    const x = (i % 2) * 6;
    const y = Math.floor(i / 2) * 4;
    return [
      { id: `chart-${i}`, type: "trend_chart", x, y, w: 4, h: 4, device_id: id, metric: METRIC },
      { id: `card-${i}`, type: "value_card", x: x + 4, y, w: 2, h: 2, device_id: id, metric: METRIC },
    ];
  });
  const patched = await request.patch(`${API_URL}/dashboards/${dash!.id}`, { headers, data: { layout } });
  expect(patched.ok(), `PATCH /dashboards: ${patched.status()}`).toBeTruthy();
  return { dashboardId: dash!.id, deviceIds };
}

/** Main-thread CPU (CDP TaskDuration over wall time), long tasks (a
 * PerformanceObserver installed before the page's own scripts), JS heap
 * sampled every 15 s, and WS frames received. */
async function measure(page: Page, label: string, frames: { count: number }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

  await page.evaluate(() => {
    (window as unknown as { __longTasks: number[] }).__longTasks.length = 0;
  });
  const framesAtStart = frames.count;
  const start = await metrics();
  const t0 = Date.now();
  const heapMb: number[] = [start.JSHeapUsedSize / 1e6];
  const end = t0 + MINUTES * 60_000;
  while (Date.now() < end) {
    await page.waitForTimeout(Math.min(15_000, end - Date.now()));
    heapMb.push((await metrics()).JSHeapUsedSize / 1e6);
  }
  const stop = await metrics();
  const seconds = (Date.now() - t0) / 1000;
  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
  await cdp.detach();

  const round = (n: number) => Math.round(n * 10) / 10;
  const result = {
    label,
    load: `${DEVICES} devices x ${HZ} Hz`,
    minutes: MINUTES,
    mainThreadCpuPct: round((100 * (stop.TaskDuration - start.TaskDuration)) / seconds),
    longTasks: longTasks.length,
    longTasksPerMin: round(longTasks.length / (seconds / 60)),
    longTaskMaxMs: round(Math.max(0, ...longTasks)),
    longTaskTotalMs: round(longTasks.reduce((a, b) => a + b, 0)),
    heapMb: { start: round(heapMb[0]), end: round(heapMb[heapMb.length - 1]), max: round(Math.max(...heapMb)) },
    wsFramesPerSec: round((frames.count - framesAtStart) / seconds),
  };
  // Printed as soon as it's measured, so a later failure doesn't lose it.
  console.log(JSON.stringify(result, null, 2));
  return result;
}

test.skip(!ENABLED, "perf probe: set PERF_REALTIME=1 to run");

test("realtime load: dashboard and device page under high-rate telemetry", async ({ page, request }, testInfo) => {
  test.setTimeout((WARMUP_S + 2 * MINUTES * 60 + 300) * 1000);
  const { accessToken, tenantId, tenantSlug } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  const { dashboardId, deviceIds } = await ensureFixtures(request, headers);

  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: number[] };
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  });
  const frames = { count: 0 };
  page.on("websocket", (ws) => {
    if (ws.url().includes("/ws?")) ws.on("framereceived", () => frames.count++);
  });

  // Runs a little longer than the test needs and stops on its own — killing
  // the `docker compose exec` client doesn't reliably stop the process inside.
  const loadMinutes = (WARMUP_S + 2 * MINUTES * 60) / 60 + 1;
  const load = spawn(
    "docker",
    [
      "compose", "-f", "../infra/docker-compose.yml", "exec", "-T", "api",
      "uv", "run", "python", "scripts/load_publish.py",
      "--tenant", tenantSlug, "--prefix", "load-", "--count", String(DEVICES),
      "--hz", String(HZ), "--minutes", String(loadMinutes),
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );

  try {
    const results = [];
    await page.goto(`/dashboards/${dashboardId}`);
    await expect(page.locator(".uplot canvas").first()).toBeVisible();
    await page.waitForTimeout(WARMUP_S * 1000);
    results.push(await measure(page, "dashboard", frames));

    await page.goto(`/devices/${deviceIds[0]}`);
    await expect(page.locator(".uplot canvas").first()).toBeVisible();
    results.push(await measure(page, "device page", frames));

    await testInfo.attach("realtime-load.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  } finally {
    load.kill();
  }
});
