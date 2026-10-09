import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("the trend chart offers a 1m range, opens on 10m and keeps its frame when empty", async ({ page }) => {
  await page.goto("/devices");
  const row = page.getByRole("table", { name: "Devices" }).locator("tbody tr").first();
  await row.locator("td").nth(-2).click();
  await page.getByRole("link", { name: "Open device" }).click();
  await expect(page).toHaveURL(/\/devices\/[0-9a-f-]{36}/);

  const ranges = page.getByRole("group", { name: "Time range" }).first();
  await expect(ranges.getByRole("button")).toHaveText(["1m", "10m", "1h", "6h", "24h", "7d"]);
  await expect(ranges.getByRole("button", { name: "10m" })).toHaveAttribute("aria-pressed", "true");

  await ranges.getByRole("button", { name: "1m" }).click();
  await expect(ranges.getByRole("button", { name: "1m" })).toHaveAttribute("aria-pressed", "true");
  // The chart frame stays up on 1m, with or without readings in the window.
  await expect(page.locator(".uplot canvas").first()).toBeVisible();
  await expect(page.getByText("No data in this range")).toHaveCount(0);
});
