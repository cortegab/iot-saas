import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("a device peeks from the list and is edited in its Settings tab", async ({ page }) => {
  await page.goto("/devices");
  const row = page.getByRole("table", { name: "Devices" }).locator("tbody tr").first();
  await row.locator("td").nth(-2).click();
  await expect(page).toHaveURL(/peek=/);
  const peek = page.getByRole("region", { name: / details$/ });
  await expect(peek.getByRole("textbox")).toHaveCount(0);
  // Read-only: Open device is the one button; the rest is in ⋯ (demo H).
  await expect(peek.getByRole("link", { name: "Edit settings" })).toHaveCount(0);
  await peek.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Rotate credential…" })).toBeVisible();
  await page.keyboard.press("Escape");

  await peek.getByRole("link", { name: "Open device" }).click();
  await expect(page).toHaveURL(/\/devices\/[0-9a-f-]{36}$/);
  // The header: template · zone overline, status and last message, Connect or Install, ⋯.
  await expect(page.getByText(/· last message /)).toBeVisible();
  await expect(page.getByRole("link", { name: /^(Connect|Install)$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Health" })).toBeVisible();

  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\?tab=settings$/);
  const name = page.getByLabel("Name", { exact: true });
  const original = await name.inputValue();
  await name.fill(`${original} draft`);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(name).toHaveValue(original);
  // The save bar only shows while there is something to save.
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);

  // One settings page: plain stacked sections, Delete last.
  await expect(page.getByText("Saving applies right away.", { exact: false })).toBeVisible();
  for (const heading of ["General", "Rule evaluation", "Template", "Wiring", "Connection", "Delete"]) {
    await expect(page.getByRole("heading", { level: 3, name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByText("Gives it")).toBeVisible();
  await page.getByText("Show its MQTT topics").click();
  await expect(page.getByText("Health (retained, last will)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Rotate credential…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete device…" })).toBeVisible();
});

test("devices list: status filter, chips and a search that matches nothing", async ({ page }) => {
  await page.goto("/devices");
  const table = page.getByRole("table", { name: "Devices" });
  await expect(table).toBeVisible();

  // The toolbar status filter, mirrored in the URL and as a chip.
  const kpis = page.getByRole("group", { name: "Filter by status" });
  await kpis.getByRole("button", { name: /Offline/ }).click();
  await expect(page).toHaveURL(/status=offline/);
  await expect(page.getByText("Status: Offline")).toBeVisible();

  // Searching for nothing shows the no-results state with Clear filters.
  await page.getByRole("searchbox", { name: "Search name or template" }).fill("zz-no-such-device");
  await expect(page.getByRole("heading", { name: "No devices match these filters" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL("/devices");
  await expect(table).toBeVisible();
});
