import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("new template: the key follows the name until edited, and bad keys are refused inline", async ({ page }) => {
  await page.goto("/templates/new");
  // Our firmware by default: the wiring comes right after General (DESIGN.md §8).
  const sections = page.locator("[data-editor-section]");
  await expect(sections.nth(1)).toHaveAttribute("data-editor-section", "hardware");
  // Own code: no wiring, and one metric to fill in.
  await page.getByRole("radio", { name: "My own code or a gateway" }).click();
  await expect(page.locator('[data-editor-section="hardware"]')).toHaveCount(0);
  const metricName = page.getByLabel("Name", { exact: true }).first();
  const key = page.getByLabel(/^Key/).first();

  // Typed character by character: the key keeps following (the old form froze it).
  await metricName.pressSequentially("Soil moisture");
  await expect(key).toHaveValue("soil-moisture");

  await key.fill("soil/moisture");
  await key.blur();
  await expect(page.getByText(/becomes an MQTT topic segment/)).toBeVisible();

  // Editing the key stops it following the name.
  await key.fill("soil_moisture");
  await metricName.fill("Soil moisture (%)");
  await expect(key).toHaveValue("soil_moisture");

  // Nothing is created while the template has no name.
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.getByText("Give the template a name.")).toBeVisible();
  await expect(page).toHaveURL("/templates/new");
});
