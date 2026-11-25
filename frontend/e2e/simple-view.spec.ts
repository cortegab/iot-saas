import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

// DESIGN.md §15a (ease-of-use C2): Simple view is each person's choice. It
// hides set-up pages and rewords; it changes no rights.
test("Simple view hides set-up pages and rewords, and switches back", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId };
  try {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/devices");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: /Device templates/ })).toBeVisible();

    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitemcheckbox", { name: "Simple view" }).click();
    await expect(nav.getByRole("link", { name: /Device templates/ })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /API keys/ })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /Automations/ })).toBeVisible();

    // Devices are tiles grouped by zone in Simple (C3), the table one toggle away.
    await expect(page.getByRole("radio", { name: "Tiles" })).toBeChecked();
    await expect(page.locator("main article").first()).toBeVisible();
    await page.getByRole("radio", { name: "Table" }).click();
    await expect(page.getByRole("table", { name: "Devices" })).toBeVisible();
    await page.getByRole("radio", { name: "Tiles" }).click();

    // A device: Overview and Automations only.
    await page.locator('main article a[href^="/devices/"]').first().click();
    const tabs = page.getByRole("tablist", { name: "Device sections" });
    await expect(tabs.getByRole("tab")).toHaveText(["Overview", /Automations/]);

    // Remembered on the server: a reload keeps it.
    await page.reload();
    await expect(nav.getByRole("link", { name: /Automations/ })).toBeVisible();
    expect((await (await request.get(`${API_URL}/tenants/current/view`, { headers })).json()).interface_mode).toBe("simple");

    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitemcheckbox", { name: "Simple view" }).click();
    await expect(nav.getByRole("link", { name: /Device templates/ })).toBeVisible();
  } finally {
    await request.patch(`${API_URL}/tenants/current/view`, { headers, data: { interface_mode: null } });
  }
});
