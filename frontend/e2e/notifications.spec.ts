import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

test("notifications: a template change shows up, dismiss with Undo, mark unread", async ({ page, request }) => {
  // A throwaway template with no devices: editing it writes an info
  // notification without pushing a new profile to any real device.
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  const name = `E2E template ${Date.now()}`;
  const created = await request.post(`${API_URL}/catalog`, { headers, data: { name, metrics: [], actuators: [] } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const entry = (await created.json()) as { id: string };
  const patched = await request.patch(`${API_URL}/catalog/${entry.id}`, {
    headers,
    data: { metrics: [{ key: "co2", name: "CO2", unit: "ppm" }] },
  });
  expect(patched.ok(), await patched.text()).toBeTruthy();

  try {
    await page.goto("/notifications");
    const row = page.getByRole("listitem").filter({ hasText: `${name} updated` });
    await expect(row).toBeVisible();
    await expect(row.getByText("Changed 1 metric. Used by 0 devices.")).toBeVisible();

    // Read ⇄ unread from the row's ⋯ menu (DESIGN.md §8: unread is the accent bar and a bold title).
    const menu = row.getByRole("button", { name: `Actions for ${name} updated` });
    await menu.click();
    const toggle = page.getByRole("menuitem", { name: /^Mark as (read|unread)$/ });
    const firstLabel = (await toggle.innerText()).trim();
    await toggle.click();
    await menu.click();
    await expect(page.getByRole("menuitem", { name: firstLabel === "Mark as read" ? "Mark as unread" : "Mark as read" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row.getByText(/, Unread:/)).toHaveCount(firstLabel === "Mark as read" ? 0 : 1);

    // The row opens a sheet with the details and the link (DESIGN.md §8).
    await row.getByRole("button", { name: /^(Info|Warning|Critical)/ }).click();
    const sheet = page.getByRole("dialog", { name: `${name} updated` });
    // Its sources are links (demo H).
    await expect(sheet.getByRole("link", { name })).toHaveAttribute("href", /templates/);
    await sheet.getByRole("button", { name: "Done" }).click();

    // Dismiss, then Undo brings it back.
    await row.getByRole("button", { name: `Actions for ${name} updated` }).click();
    await page.getByRole("menuitem", { name: "Dismiss" }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: `${name} updated` })).toBeVisible();
  } finally {
    await request.delete(`${API_URL}/catalog/${entry.id}`, { headers });
    // Keep the shared dev feed clean: dismiss this run's row.
    const feed = (await (await request.get(`${API_URL}/notifications`, { headers })).json()) as { id: string; message: string }[];
    for (const n of feed.filter((x) => x.message.startsWith("E2E template "))) {
      await request.post(`${API_URL}/notifications/${n.id}/dismiss`, { headers });
    }
  }
});

test("notifications: repeats group into one row with ×2, and filters narrow by severity", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  const name = `E2E template ${Date.now()}`;
  const entry = (await (await request.post(`${API_URL}/catalog`, { headers, data: { name, metrics: [], actuators: [] } })).json()) as { id: string };
  // Two metric changes: the same alert from the same template, twice.
  await request.patch(`${API_URL}/catalog/${entry.id}`, { headers, data: { metrics: [{ key: "co2", name: "CO2", unit: "ppm" }] } });
  await request.patch(`${API_URL}/catalog/${entry.id}`, { headers, data: { metrics: [{ key: "co2", name: "CO2", unit: "ppm" }, { key: "rh", name: "Humidity", unit: "%" }] } });

  try {
    await page.goto("/notifications");
    const rows = page.getByRole("listitem").filter({ hasText: `${name} updated` });
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("×2");
    await rows.getByRole("button", { name: /^(Info|Warning|Critical)/ }).click();
    const sheet = page.getByRole("dialog", { name: `${name} updated` });
    await expect(sheet.getByText("Each time")).toBeVisible();
    await expect(sheet.getByRole("listitem")).toHaveCount(2);
    await sheet.getByRole("button", { name: "Done" }).click();

    // Template changes are Info: a Critical filter hides them, with a chip.
    await page.getByRole("combobox", { name: "Filter by severity" }).selectOption("critical");
    await expect(page.getByText("Severity: Critical")).toBeVisible();
    await expect(rows).toHaveCount(0);

    // The status filter (DESIGN.md §6): Unread shows only what's unread,
    // Critical the unread critical ones, All clears both.
    await page.getByRole("button", { name: "Clear all" }).click();
    const states = page.getByRole("group", { name: "Filter by state" });
    await states.getByRole("button", { name: /^Unread/ }).click();
    await expect(page).toHaveURL(/show=unread/);
    await states.getByRole("button", { name: /^Critical/ }).click();
    await expect(page).toHaveURL(/severity=critical/);
    await expect(states.getByRole("button", { name: /^Critical/ })).toHaveAttribute("aria-pressed", "true");
    await states.getByRole("button", { name: /^All/ }).click();
    await expect(page).not.toHaveURL(/show=unread/);
    await expect(page).not.toHaveURL(/severity=/);
  } finally {
    await request.delete(`${API_URL}/catalog/${entry.id}`, { headers });
    const feed = (await (await request.get(`${API_URL}/notifications`, { headers })).json()) as { id: string; message: string }[];
    for (const n of feed.filter((x) => x.message.startsWith("E2E template "))) {
      await request.post(`${API_URL}/notifications/${n.id}/dismiss`, { headers });
    }
  }
});
