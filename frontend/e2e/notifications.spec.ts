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
    await expect(row.getByRole("button", { name: "Open template" })).toBeVisible();

    // Read → unread round trip through the row menu.
    await row.getByRole("button", { name: `Actions for ${name} updated` }).click();
    const first = page.getByRole("menuitem", { name: /Mark as (read|unread)/ });
    const firstLabel = (await first.innerText()).trim();
    await first.click();
    await row.getByRole("button", { name: `Actions for ${name} updated` }).click();
    await expect(page.getByRole("menuitem", { name: firstLabel === "Mark as read" ? "Mark as unread" : "Mark as read" })).toBeVisible();
    await page.keyboard.press("Escape");

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
