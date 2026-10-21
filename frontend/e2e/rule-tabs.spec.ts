import { expect } from "@playwright/test";
import { test } from "./fixtures";

// DESIGN.md §9.2–9.3 (demo H): Name and Status, the sentence, then tabs
// When · If · Then · Behaviour · Activity; conditions and actions are rows
// that open a sheet; the preview is beside the editor when there's room.

test("a new rule is a wizard: Next waits for each step, Back to the recipes, Review creates", async ({ page }) => {
  await page.goto("/rules/new");
  await page.getByRole("button", { name: /Start blank/ }).click();
  const steps = page.getByRole("list", { name: "Steps" });
  await expect(steps).toContainText("When");
  await expect(steps).toContainText("Review");
  await expect(page.getByRole("heading", { name: "What starts it?" })).toBeVisible();

  await page.getByRole("button", { name: "Next: If" }).click();
  await expect(page.getByRole("heading", { name: "What has to be true?" })).toBeFocused();
  // A blank condition stops the step.
  await page.getByRole("button", { name: "Next: Then" }).click();
  await expect(page.getByText("Fix the marked items first")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What has to be true?" })).toBeVisible();

  // Back, and on the first step back to the recipes.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "What starts it?" })).toBeVisible();
  await page.getByRole("button", { name: "Recipes" }).click();
  await expect(page.getByRole("list", { name: "Recipes" })).toBeVisible();
  await expect(page).toHaveURL(/\/rules\/new/);
});

test("a saved rule: tabs in the URL, a condition edited in its sheet, Activity has no save bar", async ({ page, ruleUnderTest }) => {
  await page.goto(`/rules/${ruleUnderTest.id}`);
  const tabs = page.getByRole("tablist", { name: "Rule sections" });
  await expect(tabs.getByRole("tab")).toHaveText([/^When/, /^If/, /^Then/, /^Behaviour/, /^Activity/]);
  // A saved rule opens on If, with the name and status on top.
  await expect(tabs.getByRole("tab", { name: /^If/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Rule name")).toHaveValue(ruleUnderTest.name);
  await expect(page.getByRole("switch", { name: "Status" })).toBeVisible();

  await page.getByRole("radiogroup", { name: "Editor view" }).getByRole("radio", { name: "Form" }).click();
  // The condition is a row; it opens in a sheet.
  await page.getByRole("button", { name: new RegExp(`^${ruleUnderTest.metric} = `) }).click();
  const sheet = page.getByRole("dialog", { name: "Condition" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();

  await tabs.getByRole("tab", { name: /^Then/ }).click();
  await expect(page).toHaveURL(/\?tab=then$/);
  await page.reload();
  await expect(tabs.getByRole("tab", { name: /^Then/ })).toHaveAttribute("aria-selected", "true");

  await tabs.getByRole("tab", { name: /^Activity/ }).click();
  await expect(page.getByRole("heading", { name: "Recent firings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeHidden();

  // Older links: ?tab=edit lands on If.
  await page.goto(`/rules/${ruleUnderTest.id}?tab=edit`);
  await expect(tabs.getByRole("tab", { name: /^If/ })).toHaveAttribute("aria-selected", "true");
});

test("the preview sits beside the editor when there's room, and behind a button otherwise", async ({ page, ruleUnderTest }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/rules/${ruleUnderTest.id}`);
  await expect(page.getByRole("complementary", { name: "Preview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview" })).toBeHidden();

  // 1150px with the rail leaves ~1006px of content: below 1080.
  await page.setViewportSize({ width: 1150, height: 800 });
  await expect(page.getByRole("complementary", { name: "Preview" })).toBeHidden();
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("dialog", { name: "Preview" })).toBeVisible();
});

test("walking a recipe to Review creates nothing until Create rule", async ({ page }) => {
  await page.goto("/rules/new");
  await page.getByRole("button", { name: /Tell me when this device goes offline/ }).click();
  for (const next of ["Next: If", "Next: Then", "Next: Behaviour", "Next: Review"]) {
    await page.getByRole("button", { name: next }).click();
  }
  await expect(page.getByRole("heading", { name: "Check and create" })).toBeVisible();
  // Regression: the last Next must not turn into the submit button mid-click.
  await expect(page).toHaveURL(/\/rules\/new/);
  await expect(page.getByText(/ created$/)).toHaveCount(0);
  await expect(page.getByLabel("Rule name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create rule" })).toBeEnabled();
});
