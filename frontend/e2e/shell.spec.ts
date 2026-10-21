import { expect } from "@playwright/test";
import { test } from "./fixtures";

// DESIGN.md §4: the full sidebar from 1440px, the icon rail from 641px, the
// phone top bar + tab bar below. The default viewport (1280) is the rail.

test("from 1440px the full sidebar shows the grouped nav, and ⌘K navigates", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const nav = page.getByRole("navigation", { name: "Sections" });
  for (const group of ["Monitor", "Automate", "Configure", "Admin"]) {
    await expect(nav.getByText(group, { exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: /Devices/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: /navigation$/ })).toHaveCount(0);

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox").fill("device templates");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/templates");
  await expect(palette).toBeHidden();
});

test("at laptop widths the icon rail labels its icons and pins open over the content", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const sidebar = page.getByRole("complementary", { name: "Primary" });
  const nav = sidebar.getByRole("navigation", { name: "Sections" });
  await expect(nav.getByText("Monitor", { exact: true })).toHaveCount(0);
  expect((await sidebar.boundingBox())?.width).toBe(64);

  // Each icon names itself in a floating tooltip on hover and on focus.
  await nav.getByRole("link", { name: "Rules" }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Rules");
  await nav.getByRole("link", { name: "Zones" }).focus();
  await expect(page.getByRole("tooltip")).toHaveText("Zones");

  const contentX = (await page.locator("#content").boundingBox())?.x;
  await sidebar.getByRole("button", { name: "Expand navigation" }).click();
  await expect(nav.getByText("Monitor", { exact: true })).toBeVisible();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(256);
  // Over the content, never pushing it.
  expect((await page.locator("#content").boundingBox())?.x).toBe(contentX);

  await page.keyboard.press("Escape");
  await expect(sidebar.getByRole("button", { name: "Expand navigation" })).toBeVisible();

  await nav.getByRole("link", { name: "Rules" }).click();
  await expect(page).toHaveURL("/rules");
  await expect(nav.getByRole("link", { name: "Rules" })).toHaveAttribute("aria-current", "page");
});

test("on a phone the tab bar and More sheet replace the sidebar, with no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("complementary", { name: "Primary" })).toBeHidden();

  const tabs = page.getByRole("navigation", { name: "Main" });
  for (const name of ["Dashboards", "Devices", "Alerts", "Rules", "More"]) {
    await expect(tabs.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(tabs.getByRole("link", { name: "Devices" })).toHaveAttribute("aria-current", "page");

  await tabs.getByRole("link", { name: "Rules" }).click();
  await expect(page).toHaveURL("/rules");

  await tabs.getByRole("button", { name: "More" }).click();
  const more = page.getByRole("dialog", { name: "More" });
  await expect(more.getByRole("button", { name: "Sign out" })).toBeVisible();
  await more.getByRole("link", { name: "Device templates" }).click();
  await expect(page).toHaveURL("/templates");
  await expect(more).toBeHidden();
  await expect(tabs.getByRole("button", { name: "More" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // The top bar's search opens the palette.
  await page.getByRole("button", { name: "Search or run" }).click();
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});

test("the skip link moves focus to the content", async ({ page }) => {
  await page.keyboard.press("Tab");
  const skip = page.getByRole("button", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#content")).toBeFocused();
});

test("old settings and template URLs redirect to their new homes", async ({ page }) => {
  await page.goto("/settings/tokens");
  await expect(page).toHaveURL("/keys");
  await page.goto("/devices/templates");
  await expect(page).toHaveURL("/templates");
  await page.goto("/settings/users");
  await expect(page).toHaveURL("/members");
});
