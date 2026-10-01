import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("workspace settings: time zone and alert recipients save, then restore", async ({ page }) => {
  const email = `e2e-alerts-${Date.now()}@example.com`;
  await page.goto("/settings");
  const tz = page.getByLabel("Time zone");
  const original = await tz.inputValue();
  const next = original === "Europe/Madrid" ? "America/Lima" : "Europe/Madrid";

  await tz.selectOption(next);
  await page.getByLabel("Add recipient").fill(email);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("list", { name: "Alert recipients" }).getByText(email)).toBeVisible();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();

  // It stuck: a reload shows the saved values.
  await page.reload();
  await expect(page.getByLabel("Time zone")).toHaveValue(next);
  await expect(page.getByRole("list", { name: "Alert recipients" }).getByText(email)).toBeVisible();

  // Put the shared dev workspace back the way it was.
  await page.getByLabel("Time zone").selectOption(original);
  await page.getByRole("button", { name: `Remove ${email}` }).click();
  await page.keyboard.press("Control+s");
  await expect(page.getByText("Settings saved")).toBeVisible();
});
