import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

// DESIGN.md §7: the save bar sits at the bottom of the window, short pages
// included; creating always shows it, editing only once there is a change.
// Controls in one row line up whatever hint sits under them.

async function barAtBottom(page: Page) {
  const bar = page.locator("body [data-savebar]").first();
  await expect(bar).toBeVisible();
  const viewport = page.viewportSize()!;
  // Polled: an edit's bar slides up as it appears.
  await expect
    .poll(async () => {
      const box = (await bar.boundingBox())!;
      return Math.abs(box.y + box.height - viewport.height);
    })
    .toBeLessThanOrEqual(1);
}

test("the save bar sits at the window bottom on short pages", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/devices/new");
  await barAtBottom(page);
  await page.goto("/zones/new");
  await barAtBottom(page);
});

test("an edit page shows the save bar only while there is a change", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/settings");
  const name = page.getByLabel("Your name", { exact: false });
  await expect(name).toBeVisible();
  await expect(page.locator("body [data-savebar]")).toHaveCount(0);
  const before = await name.inputValue();
  await name.fill(`${before} e2e`);
  await barAtBottom(page);
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(name).toHaveValue(before);
  await expect(page.locator("body [data-savebar]")).toHaveCount(0);
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

test("list pages: the primary action sits in the toolbar row, and the status filter replaces the KPI strip", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/devices");
  const search = page.getByRole("searchbox", { name: "Search name or template" });
  const add = page.getByRole("link", { name: "Add device" });
  await expect(add).toHaveCount(1);
  const s = (await search.boundingBox())!;
  const a = (await add.boundingBox())!;
  expect(Math.abs(s.y + s.height / 2 - (a.y + a.height / 2))).toBeLessThanOrEqual(4);
  const status = page.getByRole("group", { name: "Filter by status" });
  await expect(status.getByRole("button", { name: /^All \d+$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(status.getByRole("button", { name: /^Offline \d+$/ })).toBeVisible();
});
