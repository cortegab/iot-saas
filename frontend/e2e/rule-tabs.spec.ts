import { expect } from "@playwright/test";
import { test } from "./fixtures";

// DESIGN.md §9.2–9.3 (demo H): Name and Status, the sentence, then tabs
// When · If · Then · Behaviour · Activity; conditions and actions are rows
// that open a sheet; the preview is beside the editor when there's room.

test("tabs carry what blocks a save, and a blank rule isn't created", async ({ page }) => {
  await page.goto("/rules/new");
  await page.getByRole("button", { name: /Start blank/ }).click();
  const tabs = page.getByRole("tablist", { name: "Rule sections" });
  await expect(tabs.getByRole("tab", { name: "If 1 to fix" })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Then 1 to fix" })).toBeVisible();
  await page.getByRole("button", { name: "Create rule" }).click();
  await expect(page.getByText("2 to fix").first()).toBeVisible();
  // Save went to the first problem's tab.
  await expect(tabs.getByRole("tab", { name: /^If/ })).toHaveAttribute("aria-selected", "true");
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
