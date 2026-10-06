import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("rule editor: the rail shows what blocks a save, and Form ⇄ Ladder keeps the frame in place", async ({ page, ruleUnderTest }) => {
  // A blank new rule: conditions and actions are incomplete, so it can't be created yet.
  await page.goto("/rules/new");
  await page.getByRole("button", { name: /Start blank/ }).click();
  await page.getByRole("radiogroup", { name: "Editor view" }).getByRole("radio", { name: "Form" }).click();
  const rail = page.getByRole("navigation", { name: "Rule sections" });
  await expect(rail.getByRole("button", { name: /^If: 1 to fix/ })).toBeVisible();
  await expect(rail.getByRole("button", { name: /^Then: 1 to fix/ })).toBeVisible();
  await page.getByRole("button", { name: "Create rule" }).click();
  await expect(page.getByText("2 to fix").first()).toBeVisible();
  await expect(page).toHaveURL("/rules/new");

  // An existing rule: switching views changes only the canvas and the right column's content.
  await page.goto(`/rules/${ruleUnderTest.id}`);
  await page.getByRole("radiogroup", { name: "Editor view" }).getByRole("radio", { name: "Form" }).click();
  const before = await rail.boundingBox();
  await page.getByRole("radiogroup", { name: "Editor view" }).getByRole("radio", { name: "Ladder" }).click();
  await expect(page.getByRole("region", { name: "Inspector" })).toBeVisible();
  expect(await rail.boundingBox()).toEqual(before);

  // The rail picks what the inspector edits: Name → name and status.
  await rail.getByRole("button", { name: /^Name/ }).click();
  await expect(page.getByLabel("Rule name")).toHaveValue(ruleUnderTest.name);
  await expect(page.getByRole("switch", { name: "Status" })).toBeVisible();
});
