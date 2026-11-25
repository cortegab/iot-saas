import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

// Ease-of-use B4: no board yet. A simulated device sends made-up readings
// through the broker like a board, so a rule can be tried end to end.
test("a simulated device reports within seconds and a rule can be tried on it", async ({ page, request }) => {
  test.setTimeout(90_000);
  const { accessToken, tenantId } = await login(request);
  const headers = { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId };
  const name = `E2E simulated ${Date.now()}`;
  let deviceId: string | undefined;
  let ruleId: string | undefined;
  try {
    await page.goto("/devices/new");
    await page.getByRole("radio", { name: /No board yet/ }).click();
    await expect(page).toHaveURL(/from=simulated/);
    await page.getByRole("radio", { name: /Greenhouse climate/ }).click();
    await page.getByLabel("Device name").fill(name);
    await page.getByRole("button", { name: "Create simulated device" }).click();
    await expect(page).toHaveURL(/\/devices\/[0-9a-f-]{36}$/);
    deviceId = page.url().split("/devices/")[1];

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Simulated");
    await expect(page.getByText("Simulated.", { exact: true })).toBeVisible();
    // Made-up readings arrive through EMQX and ingestion like a board's.
    await expect
      .poll(async () => (await (await request.get(`${API_URL}/devices/${deviceId}/latest`, { headers })).json()).length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Online", { timeout: 30_000 });

    // Try a rule: the too-hot recipe, filled with its temperature and fan.
    await page.getByRole("link", { name: "Try a rule on it" }).click();
    const quick = page.getByRole("region", { name: "Quick rule" });
    await expect(quick.getByLabel("Device it reads")).toHaveValue(deviceId);
    await expect(quick.getByLabel("Device it switches on")).toHaveValue(deviceId);
    await quick.getByLabel("Name", { exact: true }).fill(`${name} too hot`);
    await page.getByRole("button", { name: "Create rule" }).click();
    await expect(page).toHaveURL(/\/rules\/[0-9a-f-]{36}$/);
    ruleId = page.url().split("/rules/")[1];
  } finally {
    if (ruleId) await request.delete(`${API_URL}/rules/${ruleId}`, { headers });
    if (deviceId) {
      const device = await (await request.get(`${API_URL}/devices/${deviceId}`, { headers })).json();
      await request.delete(`${API_URL}/devices/${deviceId}`, { headers });
      await request.delete(`${API_URL}/catalog/${device.catalog_entry_id}`, { headers });
    }
  }
});
