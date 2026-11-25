import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

// Ease-of-use C6: a device's alerts can be muted, and say when it's back online.
test("a device's alerts are muted from its Settings and the page says so", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId };
  const tpl = await (
    await request.post(`${API_URL}/catalog`, { headers, data: { name: `E2E alerts ${Date.now()}`, runs_on: "own_code", metrics: [{ name: "Temp", key: "temp" }] } })
  ).json();
  const device = (await (await request.post(`${API_URL}/devices`, { headers, data: { name: `E2E alerts ${Date.now()}`, catalog_entry_id: tpl.id } })).json()).device;
  try {
    await page.goto(`/devices/${device.id}?tab=settings`);
    const alerts = page.getByRole("region", { name: "Alerts" });
    await alerts.getByLabel("Offline and health alerts").selectOption("24");
    await expect(page.getByText(`${device.name}'s alerts are muted`)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Alerts muted");
    await alerts.getByRole("switch", { name: "Back online" }).click();
    await expect.poll(async () => (await (await request.get(`${API_URL}/devices/${device.id}`, { headers })).json()).notify_back_online).toBe(true);
    await alerts.getByLabel("Offline and health alerts").selectOption("off");
    await expect(page.getByRole("heading", { level: 1 })).not.toContainText("Alerts muted");
  } finally {
    await request.delete(`${API_URL}/devices/${device.id}`, { headers });
    await request.delete(`${API_URL}/catalog/${tpl.id}`, { headers });
  }
});
