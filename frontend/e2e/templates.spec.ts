import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("new template: the key follows the name until edited, and bad keys are refused inline", async ({ page }) => {
  await page.goto("/templates/new");
  // Our firmware by default: the wiring comes right after General (DESIGN.md §8).
  const sections = page.locator("[data-editor-section]");
  await expect(sections.nth(1)).toHaveAttribute("data-editor-section", "hardware");
  // Own code: no wiring, and one metric to fill in.
  await page.getByRole("radio", { name: "Custom firmware" }).click();
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

test("a part with many readings asks which to keep, and a wired part collapses to one line", async ({ page }) => {
  await page.goto("/templates/new");
  await page.getByRole("button", { name: "Set up wiring" }).click();
  await page.getByRole("button", { name: "Add input" }).click();
  await page.getByLabel("Driver").first().selectOption({ label: "MPU6050 / GY-521 motion" });

  // Only the common readings make metrics; the raw axes start not kept.
  const metrics = page.locator('[data-editor-section="metrics"]');
  await expect(metrics.getByText("tilt_x")).toBeVisible();
  await expect(page.getByLabel("Keep Accel X (g)")).not.toBeChecked();
  await expect(metrics.getByText("accel_x")).toHaveCount(0);

  // Keeping one makes its metric; dropping it again removes it.
  await page.getByLabel("Keep Accel X (g)").check();
  await expect(metrics.getByText("accel_x")).toBeVisible();
  await page.getByLabel("Keep Accel X (g)").uncheck();
  await expect(metrics.getByText("accel_x")).toHaveCount(0);

  // Collapsed: driver · bus · what it feeds, on one line.
  await page.getByRole("button", { name: "Collapse input 1" }).click();
  await expect(page.getByText(/MPU6050 \/ GY-521 motion · I2C · Tilt X/)).toBeVisible();
  await expect(page.getByLabel("Keep Accel X (g)")).toHaveCount(0);
});

test("replacing a part keeps the metric it fed, and a metric no part feeds is tagged Not wired", async ({ page }) => {
  await page.goto("/templates/new");
  await page.getByRole("button", { name: "Set up wiring" }).click();
  await page.getByRole("button", { name: "Add input" }).click();
  await page.getByLabel("Driver").first().selectOption({ label: "DHT22 / AM2302" });
  await page.getByLabel(/^Name of what Temperature .*feeds$/).fill("Air");

  // Replace part: a DS18B20's °C probe takes over the °C metric, name and all.
  await page.getByLabel("Driver").first().selectOption({ label: "DS18B20 temperature" });
  await expect(page.getByLabel(/^Name of what .*1.* feeds$/)).toHaveValue("Air");

  // A metric typed in by hand, that no part feeds.
  const metrics = page.locator('[data-editor-section="metrics"]');
  await metrics.getByRole("button", { name: "Add metric" }).click();
  await expect(metrics.getByText("Not wired")).toBeVisible();
});
