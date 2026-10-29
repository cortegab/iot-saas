import { expect } from "@playwright/test";
import { test } from "./fixtures";

// DESIGN.md §6: columns fold by priority as the content narrows, rows become
// cards at 600px, and on phones the filter menus move into a sheet.

test("devices: Template and Zone fold into the name line as the content narrows", async ({ page }) => {
  const table = page.getByRole("table", { name: "Devices" });
  const header = (name: string) => table.getByRole("columnheader", { name });

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(header("Template")).toBeVisible();
  await expect(header("Zone")).toBeVisible();

  // 820px window: the rail leaves ~676px of content, below both P3 and P2.
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(header("Template")).toBeHidden();
  await expect(header("Zone")).toBeHidden();
  await expect(header("Status")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("devices on a phone: cards, a Filters sheet, and no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("combobox", { name: "Filter by zone" })).toHaveCount(0);

  await page.getByRole("button", { name: "Filters" }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet.getByRole("combobox", { name: "Filter by template" })).toBeVisible();
  await expect(sheet.getByRole("combobox", { name: "Filter by zone" })).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("rules: the state filter, the Trigger filter makes a chip, and Ladder shows cards", async ({ page, ruleUnderTest }) => {
  await page.goto("/rules");
  const kpis = page.getByRole("group", { name: "Filter by state" }); // the toolbar status filter (DESIGN.md §6)
  for (const name of ["Armed", "Fired", "Latched", "Can't evaluate", "Disabled"]) {
    await expect(kpis.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await kpis.getByRole("button", { name: /^Fired/ }).click();
  await expect(page).toHaveURL(/state=fired/);
  await expect(page.getByText("State: Fired in 24 h")).toBeVisible();
  await kpis.getByRole("button", { name: /^All/ }).click();
  await expect(page).not.toHaveURL(/state=/);

  await page.getByRole("searchbox", { name: "Search rules" }).fill(ruleUnderTest.name);
  // The search is debounced into the URL; let it land before the next filter.
  await expect(page).toHaveURL(/[?&]q=/);
  await page.getByRole("combobox", { name: "Filter by trigger" }).selectOption("metric");
  await expect(page.getByText("Trigger: On each reading")).toBeVisible();
  await expect(page.getByRole("link", { name: ruleUnderTest.name })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter by trigger" }).selectOption("schedule");
  await expect(page.getByRole("link", { name: ruleUnderTest.name })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove filter Trigger: On a schedule" }).click();
  // Let the removal land in the URL before the next change, or the view switch
  // would be applied on top of the stale filters.
  await expect(page.getByText("Trigger: On a schedule")).toHaveCount(0);

  await page.getByRole("radio", { name: "Ladder" }).click();
  await expect(page.getByRole("link", { name: `Edit ${ruleUnderTest.name}` })).toBeVisible();
});

test("rules: Failed deliveries is a state that swaps in the delivery feed, and the old URL lands on it", async ({ page, ruleUnderTest }) => {
  await page.goto("/rules");
  await expect(page.getByRole("link", { name: ruleUnderTest.name })).toBeVisible();
  // No tabs above the list any more (DESIGN.md §6).
  await expect(page.getByRole("tablist", { name: "Rule views" })).toHaveCount(0);
  const states = page.getByRole("group", { name: "Filter by state" });
  await states.getByRole("button", { name: /^Failed deliveries/ }).click();
  await expect(page).toHaveURL(/state=failed/);
  // The feed, or its empty state; the rule-only controls step aside.
  await expect(page.getByRole("table", { name: "Failed deliveries" }).or(page.getByText("Nothing failed"))).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search rules" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Filter by trigger" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Ladder" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "New rule" })).toBeVisible();
  await states.getByRole("button", { name: /^All/ }).click();
  await expect(page.getByRole("link", { name: ruleUnderTest.name })).toBeVisible();

  await page.goto("/rules/failed-actions");
  await expect(page).toHaveURL(/\/rules\?state=failed/);
  await expect(states.getByRole("button", { name: /^Failed deliveries/ })).toHaveAttribute("aria-pressed", "true");
});
