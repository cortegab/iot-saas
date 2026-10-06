import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

test("dashboard: edit layout, add a widget, change width, remove and undo", async ({ page, request }) => {
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

    await page.locator("header").getByRole("button", { name: "Add widget" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "Device status" }).click();
    await dialog.getByRole("button", { name: "Add widget" }).click();
    await expect(page.getByText("Device status added")).toBeVisible();

    const width = page.getByRole("button", { name: /^Width 3 of 12 columns/ });
    await width.click();
    await expect(page.getByRole("button", { name: /^Width 4 of 12 columns/ })).toBeVisible();

    await page.getByRole("button", { name: "Remove Device status" }).click();
    await expect(page.getByText("Device status removed")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Remove Device status" })).toBeVisible();

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page).not.toHaveURL(/edit=1/);
    await expect(page.getByRole("button", { name: "Remove Device status" })).toHaveCount(0);

    // It saved: the API has the widget at width 4.
    const saved = await (await request.get(`${API_URL}/dashboards/${dash.id}`, { headers })).json();
    expect(saved.layout).toHaveLength(1);
    expect(saved.layout[0].w).toBe(4);
  } finally {
    await request.delete(`${API_URL}/dashboards/${dash.id}`, { headers });
  }
});

test("dashboard: an unknown id explains itself instead of spinning", async ({ page }) => {
  await page.goto("/dashboards/00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("heading", { name: "This dashboard doesn't exist" })).toBeVisible();
  await expect(page.getByRole("link", { name: "All dashboards" })).toBeVisible();
});

test("new dashboard: named on its own page, then straight to Edit layout", async ({ page, request }) => {
  const name = `E2E new dash ${Date.now()}`;
  await page.goto("/dashboards");
  await page.locator("header").getByRole("link", { name: "New dashboard" }).click();
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
