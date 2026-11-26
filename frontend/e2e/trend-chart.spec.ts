import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

test("the trend chart offers a 1m range, opens on 10m and keeps its frame when empty", async ({ page, request }) => {
  // Its own device with one reading (the HTTP ingest fallback, the device's
  // own credential): a device that has never sent anything shows "The chart
  // starts the moment a reading arrives." instead of the chart.
  const { accessToken, tenantId } = await login(request);
  const headers = { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId };
  const stamp = Date.now();
  const tpl = await (
    await request.post(`${API_URL}/catalog`, { headers, data: { name: `E2E trend ${stamp}`, runs_on: "own_code", metrics: [{ name: "Temp", key: "temp" }] } })
  ).json();
  const created = await (await request.post(`${API_URL}/devices`, { headers, data: { name: `E2E trend ${stamp}`, catalog_entry_id: tpl.id } })).json();
  const device = created.device as { id: string };
  try {
    const basic = Buffer.from(`${created.credential.username}:${created.credential.password}`).toString("base64");
    const sent = await request.post(`${API_URL}/ingest`, { headers: { authorization: `Basic ${basic}` }, data: { metric: "temp", value: 21.5 } });
    expect(sent.status(), await sent.text()).toBe(202);

    await page.goto(`/devices/${device.id}`);
    const ranges = page.getByRole("radiogroup", { name: "Time range" }).first();
    await expect(ranges.getByRole("radio")).toHaveText(["1m", "10m", "1h", "6h", "24h", "7d"]);
    await expect(ranges.getByRole("radio", { name: "10m" })).toHaveAttribute("aria-checked", "true");

    await ranges.getByRole("radio", { name: "1m" }).click();
    await expect(ranges.getByRole("radio", { name: "1m" })).toHaveAttribute("aria-checked", "true");
    // The chart frame stays up on 1m, with or without readings in the window.
    await expect(page.locator(".uplot canvas").first()).toBeVisible();
    await expect(page.getByText("No data in this range")).toHaveCount(0);
  } finally {
    await request.delete(`${API_URL}/devices/${device.id}`, { headers });
    await request.delete(`${API_URL}/catalog/${tpl.id}`, { headers });
  }
});
