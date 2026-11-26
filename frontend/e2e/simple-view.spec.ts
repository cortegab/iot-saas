import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

// DESIGN.md §15a (ease-of-use C2): Simple view is each person's choice. It
// hides set-up pages and rewords; it changes no rights.
test("Simple view hides set-up pages and rewords, and switches back", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId };
  await request.patch(`${API_URL}/tenants/current/view`, { headers, data: { interface_mode: null } });
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
    // Simple words (C4): areas and device types, not zones and templates.
    await expect(page.getByLabel("Filter by device type")).toBeVisible();
    await page.getByRole("radio", { name: "Table" }).click();
    await expect(page.getByRole("table", { name: "Devices" })).toBeVisible();
    await page.getByRole("radio", { name: "Tiles" }).click();

    // A device: Overview and Automations, and Settings for whoever can edit it.
    await page.locator('main article a[href^="/devices/"]').first().click();
    const tabs = page.getByRole("tablist", { name: "Device sections" });
    await expect(tabs.getByRole("tab")).toHaveText(["Overview", /Automations/, "Settings"]);

    // Get started starts at the device: Add device makes its template.
    await page.goto("/start");
    const steps = page.getByRole("list", { name: "Setup steps" });
    await expect(steps.getByRole("listitem")).toHaveCount(3);
    await expect(steps).not.toContainText("device template");
    await expect(steps).toContainText("Create an automation");

    // Remembered on the server: a reload keeps it.
    await page.reload();
    await expect(nav.getByRole("link", { name: /Automations/ })).toBeVisible();
    expect((await (await request.get(`${API_URL}/tenants/current/view`, { headers })).json()).interface_mode).toBe("simple");

    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitemcheckbox", { name: "Simple view" }).click();
    await expect(nav.getByRole("link", { name: /Device templates/ })).toBeVisible();
    await expect(page.getByRole("list", { name: "Setup steps" }).getByRole("listitem")).toHaveCount(4);
  } finally {
    await request.patch(`${API_URL}/tenants/current/view`, { headers, data: { interface_mode: null } });
  }
});

// A switch that can't be saved goes back and says so.
test("Simple view switch that fails to save goes back", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  await request.patch(`${API_URL}/tenants/current/view`, {
    headers: { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId },
    data: { interface_mode: null },
  });
  await page.route("**/tenants/current/view", (route) =>
    route.request().method() === "PATCH" ? route.fulfill({ status: 500, json: { detail: "down" } }) : route.fallback(),
  );
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/devices");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: /Device templates/ })).toBeVisible();
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Simple view" }).click();
  await expect(page.getByText("Couldn't change the view")).toBeVisible();
  await expect(nav.getByRole("link", { name: /Device templates/ })).toBeVisible();
});
