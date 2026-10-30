import { expect } from "@playwright/test";
import { test } from "./fixtures";

// DESIGN.md §9.2–9.3 (demo H): the sentence is the header's description,
// then tabs Basics · When · If · Then · Behaviour · Activity; conditions and
// actions are rows that open a sheet; the preview is behind its button.

test("a new rule is a wizard: Next waits for each step, Back to the recipes, Review creates", async ({ page }) => {
  await page.goto("/rules/new");
  // DESIGN.md §9.1: a recipe or blank first; the name is asked on Review.
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
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
  await expect(tabs.getByRole("tab")).toHaveText([/^Basics/, /^When/, /^If/, /^Then/, /^Behaviour/, /^Activity/]);
  // The sentence sits in the header, above the tabs (like a template's).
  const sentence = page.getByLabel("Rule sentence");
  expect((await sentence.boundingBox())!.y).toBeLessThan((await tabs.boundingBox())!.y);
  // A saved rule opens on Basics: its name and status.
  await expect(tabs.getByRole("tab", { name: /^Basics/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(ruleUnderTest.name);
  await expect(page.getByRole("switch", { name: "Status" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveCount(0);

  await tabs.getByRole("tab", { name: /^If/ }).click();

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
  await expect(page.getByRole("button", { name: "Save rule" })).toBeHidden();

  // Older links: ?tab=edit lands on If.
  await page.goto(`/rules/${ruleUnderTest.id}?tab=edit`);
  await expect(tabs.getByRole("tab", { name: /^If/ })).toHaveAttribute("aria-selected", "true");
});

test("the preview is behind its button at every width, beside the 760px editor", async ({ page, ruleUnderTest }) => {
  for (const width of [1600, 400]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/rules/${ruleUnderTest.id}?tab=if`);
    // The same column as every editor (DESIGN.md §4), and no side panel.
    expect((await page.getByRole("tablist", { name: "Rule sections" }).boundingBox())!.width).toBeLessThanOrEqual(760);
    await expect(page.getByRole("complementary", { name: "Preview" })).toHaveCount(0);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Preview" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Last 24 hours" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
});

test("walking a recipe to Review creates nothing until Create rule", async ({ page }) => {
  await page.goto("/rules/new");
  // No device on the first page: recipe, then the device in the When step.
  await expect(page.getByLabel("Device", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Tell me when a device goes offline/ }).click();
  await page.getByLabel("Watched device").selectOption({ index: 1 });
  // Not on a reading, so no Behaviour step: its one timer is in Then.
  await expect(page.getByRole("list", { name: "Steps" })).not.toContainText("Behaviour");
  await page.getByRole("button", { name: "Next: If" }).click();
  await page.getByRole("button", { name: "Next: Then" }).click();
  await expect(page.getByLabel(/^Minimum interval/)).toBeVisible();
  await page.getByRole("button", { name: "Next: Review" }).click();
  // The recipe suggests a name; Review is where it's changed.
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Device offline");
  await page.getByLabel("Name", { exact: true }).fill("E2E offline recipe");
  await expect(page.getByRole("heading", { name: "Check and create" })).toBeVisible();
  // Regression: the last Next must not turn into the submit button mid-click.
  await expect(page).toHaveURL(/\/rules\/new/);
  await expect(page.getByText(/ created$/)).toHaveCount(0);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("E2E offline recipe");
  await expect(page.getByRole("button", { name: "Create rule" })).toBeEnabled();
});
