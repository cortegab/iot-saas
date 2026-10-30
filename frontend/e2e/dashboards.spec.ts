import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

test("dashboard: edit layout, add a widget in steps, change it in its sheet, remove and undo", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  const created = await request.post(`${API_URL}/dashboards`, { headers, data: { name: `E2E dash ${Date.now()}` } });
  expect(created.ok()).toBeTruthy();
  const dash = (await created.json()) as { id: string; name: string };

  try {
    await page.goto(`/dashboards/${dash.id}`);
    await expect(page.getByText("No widgets yet")).toBeVisible();
    await page.getByRole("button", { name: "Edit layout" }).click();
    await expect(page).toHaveURL(/edit=1/);
    await expect(page.getByText("Editing layout.")).toBeVisible();

    // Add a widget in three steps (DESIGN.md §8): Type → Source → Size.
    await page.locator("header").getByRole("button", { name: "Add widget" }).click();
    const add = page.getByRole("dialog", { name: "Add a widget" });
    await add.getByRole("button", { name: /^Device status/ }).click();
    await add.getByRole("button", { name: "Next: Size" }).click();
    await add.getByRole("radio", { name: "M", exact: true }).click();
    await add.getByRole("button", { name: "Add widget" }).click();
    await expect(page.getByText("Device status added")).toBeVisible();

    // Click it to change it in its sheet; changes apply as you go.
    await page.getByRole("button", { name: /^Edit Device status/ }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("radio", { name: "L", exact: true }).click();
    // Remove from the sheet, with Undo.
    await sheet.getByRole("button", { name: "Remove widget" }).click();
    await expect(page.getByText("Device status removed")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: /^Edit Device status/ })).toBeVisible();

    await page.locator("header").getByRole("button", { name: "Done" }).click();
    await expect(page).not.toHaveURL(/edit=1/);
    await expect(page.getByRole("button", { name: /^Edit Device status/ })).toHaveCount(0);

    // It saved: the API has the widget at size L (8 of 12). Saves are async, so wait for it.
    await expect
      .poll(async () => (await (await request.get(`${API_URL}/dashboards/${dash.id}`, { headers })).json()).layout.map((w: { w: number }) => w.w))
      .toEqual([8]);
  } finally {
    await request.delete(`${API_URL}/dashboards/${dash.id}`, { headers });
  }
});

test("dashboard: an unknown id explains itself instead of spinning", async ({ page }) => {
  await page.goto("/dashboards/00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("heading", { name: "This dashboard doesn't exist" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to dashboards" })).toBeVisible();
});

test("new dashboard: named on its own page, then straight to Edit layout", async ({ page, request }) => {
  const name = `E2E new dash ${Date.now()}`;
  await page.goto("/dashboards");
  await page.getByRole("main").getByRole("link", { name: "New dashboard" }).click();
  await expect(page).toHaveURL("/dashboards/new");
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create dashboard" }).click();
  await expect(page.getByText("Dashboard created")).toBeVisible();
  await expect(page).toHaveURL(/\/dashboards\/[0-9a-f-]{36}\?edit=1$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;

  const { accessToken, tenantId } = await login(request);
  await request.delete(`${API_URL}/dashboards/${id}`, { headers: { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId } });
});

test("dashboard on a phone: Edit layout is a list to open and reorder", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  const devices = (await (await request.get(`${API_URL}/devices`, { headers })).json()) as { id: string; name: string }[];
  const dash = (await (await request.post(`${API_URL}/dashboards`, { headers, data: { name: `E2E phone dash ${Date.now()}` } })).json()) as { id: string };
  const a = { id: crypto.randomUUID(), type: "device_status", x: 0, y: 0, w: 4, h: 2, device_id: devices[0].id };
  const b = { id: crypto.randomUUID(), type: "actuator_control", x: 4, y: 0, w: 4, h: 3, device_id: devices[0].id };
  await request.patch(`${API_URL}/dashboards/${dash.id}`, { headers, data: { layout: [a, b] } });

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/dashboards/${dash.id}?edit=1`);
    const list = page.getByRole("list", { name: "Widgets" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByRole("listitem").first()).toContainText("Device status");

    // Moving swaps grid places with the neighbour.
    await list.getByRole("button", { name: /up$/ }).last().click();
    await expect(list.getByRole("listitem").first()).toContainText("Actuator control");
    await expect
      .poll(async () => {
        const layout = (await (await request.get(`${API_URL}/dashboards/${dash.id}`, { headers })).json()).layout as { id: string; x: number }[];
        return layout.find((w) => w.id === b.id)?.x;
      })
      .toBe(0);

    // Opening a row opens the same sheet as a click on the grid.
    await list.getByRole("listitem").first().getByRole("button").first().click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Remove widget" })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await request.delete(`${API_URL}/dashboards/${dash.id}`, { headers });
  }
});

test("default dashboard: set from the row menu, tagged, and the sidebar's Dashboards opens it", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  // The dev account may have its own default: put it back afterwards.
  const before = ((await (await request.get(`${API_URL}/tenants/current/counts`, { headers })).json()) as { default_dashboard_id: string | null }).default_dashboard_id;
  const name = `E2E default dash ${Date.now()}`;
  const dash = (await (await request.post(`${API_URL}/dashboards`, { headers, data: { name } })).json()) as { id: string };

  try {
    await page.goto("/dashboards");
    const row = page.getByRole("row").filter({ hasText: name });
    await row.getByRole("button", { name: /actions/i }).click();
    await page.getByRole("menuitem", { name: "Set as default" }).click();
    await expect(page.getByText(`${name} is your default dashboard`)).toBeVisible();
    await expect(row.getByText("Default", { exact: true })).toBeVisible();

    // DESIGN.md §4: Dashboards in the sidebar goes to the default.
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Dashboards/ })).toHaveAttribute("href", `/dashboards/${dash.id}`);

    // Its page says so, and its menu takes it back.
    await page.goto(`/dashboards/${dash.id}`);
    await expect(page.getByText("Default", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "More dashboard actions" }).click();
    await page.getByRole("menuitem", { name: "Remove as default" }).click();
    await expect(page.getByText(`${name} is no longer your default`)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Dashboards/ })).toHaveAttribute("href", "/dashboards");
  } finally {
    await request.delete(`${API_URL}/dashboards/${dash.id}`, { headers });
    if (before) await request.put(`${API_URL}/dashboards/${before}/default`, { headers });
  }
});
