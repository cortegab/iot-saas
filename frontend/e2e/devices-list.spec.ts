import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("a device peeks from the list and is edited in its Settings tab", async ({ page }) => {
  await page.goto("/devices");
  const row = page.getByRole("table", { name: "Devices" }).locator("tbody tr").first();
  await row.locator("td").nth(-2).click();
  await expect(page).toHaveURL(/peek=/);
  const peek = page.getByRole("region", { name: / details$/ });
  await expect(peek.getByRole("link", { name: "Open device" })).toBeVisible();
  await expect(peek.getByRole("textbox")).toHaveCount(0);

  await peek.getByRole("link", { name: "Edit settings" }).click();
  await expect(page).toHaveURL(/\/devices\/[0-9a-f-]{36}\?tab=settings$/);
  const name = page.getByLabel("Name", { exact: true });
  const original = await name.inputValue();
  await name.fill(`${original} draft`);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(name).toHaveValue(original);
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("devices list: KPI filter, chips and a search that matches nothing", async ({ page }) => {
  await page.goto("/devices");
  const table = page.getByRole("table", { name: "Devices" });
  await expect(table).toBeVisible();

  // A KPI tile toggles the status filter, mirrored in the URL and as a chip.
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
