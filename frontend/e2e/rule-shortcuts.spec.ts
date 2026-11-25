import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

// Ease-of-use B2: a rule starts where the need appears. A reading's "Alert me…"
// and an output's "Automate…" open a recipe's one screen, already filled.
test("Alert me… and Automate… open a recipe filled with that reading or output", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId };
  const stamp = Date.now();
  const tpl = await (
    await request.post(`${API_URL}/catalog`, {
      headers,
      data: {
        name: `E2E shortcuts ${stamp}`,
        runs_on: "own_code",
        metrics: [{ name: "Air temp", key: "air-temp", unit: "°C", min: 0, max: 50 }],
        actuators: [{ name: "Fan", key: "fan" }],
      },
    })
  ).json();
  const created = await (await request.post(`${API_URL}/devices`, { headers, data: { name: `E2E shortcuts ${stamp}`, catalog_entry_id: tpl.id } })).json();
  const device = created.device as { id: string };

  try {
    await page.goto(`/devices/${device.id}`);
    await page.getByRole("link", { name: "Alert me about Air temp" }).click();
    await expect(page).toHaveURL(/\/rules\/new\?recipe=reading-high/);
    const quick = page.getByRole("region", { name: "Quick rule" });
    await expect(quick.getByRole("heading", { name: "Notify me when a reading is too high" })).toBeVisible();
    await expect(quick.getByLabel("Device it reads")).toHaveValue(device.id);
    await expect(quick.getByLabel("Reading")).toHaveValue("air-temp");
    // A limit inside the reading's 0–50 range.
    await expect(quick.getByLabel("When it's above")).toHaveValue("38");

    // Back to the recipes drops the prefill.
    await page.getByRole("button", { name: "Recipes" }).click();
    await expect(page.getByRole("list", { name: "Recipes" })).toBeVisible();

    await page.goto(`/devices/${device.id}`);
    await page.getByRole("link", { name: "Automate Fan" }).click();
    await expect(quick.getByRole("heading", { name: "Turn something on when it's too hot" })).toBeVisible();
    await expect(quick.getByLabel("Device it switches on")).toHaveValue(device.id);
    await expect(quick.getByLabel("Output")).toHaveValue("fan");
  } finally {
    await request.delete(`${API_URL}/devices/${device.id}`, { headers });
    await request.delete(`${API_URL}/catalog/${tpl.id}`, { headers });
  }
});
