import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("zones: create, rename and delete an empty zone from the docked editor", async ({ page }) => {
  const name = `E2E zone ${Date.now()}`;
  await page.goto("/zones");
  // The page header's button; an empty list repeats it in its first-use state.
  await page.locator("header").getByRole("button", { name: "New zone" }).click();

  const editor = page.getByRole("region", { name: /editor$/ });
  await editor.getByLabel("Name", { exact: true }).fill(name);
  await editor.getByRole("button", { name: "Create zone" }).click();
  await expect(page.getByText("Zone created")).toBeVisible();
  await expect(page.getByRole("table", { name: "Zones" }).getByText(name)).toBeVisible();

  await editor.getByLabel("Name", { exact: true }).fill(`${name} renamed`);
  await page.keyboard.press("Control+s");
  await expect(page.getByText("Zone saved")).toBeVisible();

  await editor.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete zone…" }).click();
  await page.getByRole("button", { name: "Delete zone" }).click();
  await expect(page.getByText(`${name} renamed deleted`)).toBeVisible();
  await expect(page.getByRole("table", { name: "Zones" }).getByText(`${name} renamed`)).toHaveCount(0);
});
