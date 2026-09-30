import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("sidebar shows the grouped nav and ⌘K opens the palette that navigates", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Sections" });
  for (const group of ["Monitor", "Automate", "Configure", "Admin"]) {
    await expect(nav.getByText(group, { exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: /Devices/ })).toHaveAttribute("aria-current", "page");

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox").fill("device templates");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/templates");
  await expect(palette).toBeHidden();
});

test("old settings and template URLs redirect to their new homes", async ({ page }) => {
  await page.goto("/settings/tokens");
  await expect(page).toHaveURL("/keys");
  await page.goto("/devices/templates");
  await expect(page).toHaveURL("/templates");
  await page.goto("/settings/users");
  await expect(page).toHaveURL("/members");
});
