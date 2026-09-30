import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("new template: the key follows the name until edited, and bad keys are refused inline", async ({ page }) => {
  await page.goto("/templates/new");
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
