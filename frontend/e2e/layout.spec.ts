import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

// DESIGN.md §7: the save bar is always at the bottom of the window, short
// pages included; controls in one row line up whatever hint sits under them.

async function barAtBottom(page: Page) {
  const bar = page.locator("[data-savebar]").first();
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(1);
}

test("the save bar sits at the window bottom on short pages", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/devices/new");
  await barAtBottom(page);
  await page.goto("/zones/new");
  await barAtBottom(page);
});

test("controls in one row line up, whatever hint sits under them", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/devices/new");
  // Device name has a two-line hint; Zone has none.
  const name = (await page.getByLabel("Device name").boundingBox())!;
  const zone = (await page.getByLabel(/^Zone/).boundingBox())!;
  expect(Math.abs(name.y - zone.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(name.height - zone.height)).toBeLessThanOrEqual(1);
});
