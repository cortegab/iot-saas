import { expect } from "@playwright/test";
import { test } from "./fixtures";

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
