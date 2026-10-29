import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("the trend chart offers a 1m range, opens on 10m and keeps its frame when empty", async ({ page, ruleUnderTest }) => {
  // The fixture's own device: its template has a metric, so the chart shows
  // whatever else happens to be first in the shared dev workspace's list.
  await page.goto(`/devices/${ruleUnderTest.deviceId}`);

  const ranges = page.getByRole("radiogroup", { name: "Time range" }).first();
  await expect(ranges.getByRole("radio")).toHaveText(["1m", "10m", "1h", "6h", "24h", "7d"]);
  await expect(ranges.getByRole("radio", { name: "10m" })).toHaveAttribute("aria-checked", "true");

  await ranges.getByRole("radio", { name: "1m" }).click();
  await expect(ranges.getByRole("radio", { name: "1m" })).toHaveAttribute("aria-checked", "true");
  // The chart frame stays up on 1m, with or without readings in the window.
  await expect(page.locator(".uplot canvas").first()).toBeVisible();
  await expect(page.getByText("No data in this range")).toHaveCount(0);
});
