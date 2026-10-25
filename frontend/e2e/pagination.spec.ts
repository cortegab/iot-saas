import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

// DESIGN.md §6: every list that can grow pages at 25 / 50 / 100; history is
// paged by the API (X-Total-Count), so all of it can be browsed, not just the
// latest 100. Short lists show no pager.

test("the command timeline pages past the old 100-row cap, filters on the server, and short lists show no pager", async ({ page, request, ruleUnderTest }) => {
  test.setTimeout(180_000);
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  const stamp = Date.now();
  const tpl = await (
    await request.post(`${API_URL}/catalog`, { headers, data: { name: `E2E paging ${stamp}`, runs_on: "own_code", actuators: [{ name: "Fan", key: "fan1" }] } })
  ).json();
  const created = await (await request.post(`${API_URL}/devices`, { headers, data: { name: `E2E paging ${stamp}`, catalog_entry_id: tpl.id } })).json();
  const deviceId = created.device.id as string;

  try {
    // 120 commands; the worker writes each row a moment after the 202.
    for (let i = 0; i < 120; i++) {
      const res = await request.post(`${API_URL}/devices/${deviceId}/commands`, { headers, data: { actuator: "fan1", value: i % 2 === 0 } });
      expect(res.status()).toBe(202);
    }
    await expect
      .poll(async () => Number((await request.get(`${API_URL}/devices/${deviceId}/commands?limit=1`, { headers })).headers()["x-total-count"]), { timeout: 60_000 })
      .toBe(120);

    await page.goto(`/devices/${deviceId}?tab=controls`);
    const timeline = page.getByRole("list", { name: "Commands" });
    await expect(timeline.getByRole("listitem")).toHaveCount(25);
    await expect(page.getByText("Page 1 of 5")).toBeVisible();

    // The last page holds the oldest commands, beyond the old cap of 100.
    for (let p = 1; p < 5; p++) await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Page 5 of 5")).toBeVisible();
    await expect(timeline.getByRole("listitem")).toHaveCount(20);

    // A filter is applied by the API and goes back to page 1. Nothing was
    // acknowledged, so Acknowledged is empty.
    await page.getByRole("radiogroup", { name: "Result" }).getByRole("radio", { name: "Acknowledged" }).click();
    await expect(page.getByText("No commands match.")).toBeVisible();
    await page.getByRole("radiogroup", { name: "Result" }).getByRole("radio", { name: "All" }).click();
    await expect(page.getByText("Page 1 of 5")).toBeVisible();

    // A short list (the fixture rule's one version) shows only its count.
    await page.goto(`/rules/${ruleUnderTest.id}?tab=activity`);
    await expect(page.getByRole("list", { name: "Versions" }).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveCount(0);
  } finally {
    await request.delete(`${API_URL}/devices/${deviceId}`, { headers });
    await request.delete(`${API_URL}/catalog/${tpl.id}`, { headers });
  }
});
