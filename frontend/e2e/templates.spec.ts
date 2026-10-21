import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

// DESIGN.md §7/§8: a new template is a wizard (Basics → Hardware → Data →
// Review); parts, metrics and actuators are rows that open in a sheet.

test("new template: Next waits for a name, and a metric's key follows its name in its sheet", async ({ page }) => {
  await page.goto("/templates/new");
  const steps = page.getByRole("list", { name: "Steps" });
  // Our firmware by default: the wiring is its own step (DESIGN.md §8).
  await expect(steps).toContainText("Hardware");
  // Custom firmware: no wiring step.
  await page.getByRole("radio", { name: "Custom firmware" }).click();
  await expect(steps).not.toContainText("Hardware");

  // Nothing moves on while the template has no name.
  await page.getByRole("button", { name: "Next: Data" }).click();
  await expect(page.getByText("Give the template a name.")).toBeVisible();
  await expect(page.getByLabel("Template name")).toBeFocused();
  await page.getByLabel("Template name").fill(`E2E template ${Date.now()}`);
  await page.getByRole("button", { name: "Next: Data" }).click();
  await expect(page.getByRole("heading", { name: "What does it publish and switch?" })).toBeFocused();

  // Its one blank metric is a row; it opens in a sheet.
  await page.getByRole("button", { name: /Unnamed/ }).click();
  const sheet = page.getByRole("dialog");
  const metricName = sheet.getByLabel("Name", { exact: true });
  const key = sheet.getByLabel(/^Key/);

  // Typed character by character: the key keeps following (the old form froze it).
  await metricName.pressSequentially("Soil moisture");
  await expect(key).toHaveValue("soil-moisture");

  await key.fill("soil/moisture");
  await key.blur();
  await expect(sheet.getByText(/becomes an MQTT topic segment/)).toBeVisible();

  // Editing the key stops it following the name.
  await key.fill("soil_moisture");
  await metricName.fill("Soil moisture (%)");
  await expect(key).toHaveValue("soil_moisture");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: /Soil moisture \(%\)/ })).toContainText("soil_moisture");

  // Review lists it, with Change back to its step.
  await page.getByRole("button", { name: "Next: Review" }).click();
  await expect(page.getByRole("button", { name: "Create template" })).toBeVisible();
  await page.getByRole("button", { name: "Change metrics" }).click();
  await expect(page.getByRole("heading", { name: "What does it publish and switch?" })).toBeVisible();
});

test("a part with many readings asks which to keep in its sheet, and closes to one line", async ({ page }) => {
  await page.goto("/templates/new");
  await page.getByLabel("Template name").fill(`E2E motion ${Date.now()}`);
  await page.getByRole("button", { name: "Next: Hardware" }).click();
  await page.getByRole("button", { name: "Set up wiring" }).click();
  await page.getByRole("button", { name: "Add input" }).click();

  // A new part opens its sheet straight away.
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Driver").selectOption({ label: "MPU6050 / GY-521 motion" });

  // Only the common readings make metrics; the raw axes start not kept.
  const seen = page.locator("p", { hasText: /What you.ll see:/ });
  await expect(sheet.getByLabel("Keep Accel X (g)")).not.toBeChecked();
  await expect(seen).not.toContainText("Accel X");

  // Keeping one makes its metric; dropping it again removes it.
  await sheet.getByLabel("Keep Accel X (g)").check();
  await expect(seen).toContainText("Accel X");
  await sheet.getByLabel("Keep Accel X (g)").uncheck();
  await expect(seen).not.toContainText("Accel X");

  // Closed: driver, then bus · what it feeds, on one line.
  await sheet.getByRole("button", { name: "Done" }).click();
  const row = page.getByRole("button", { name: /MPU6050 \/ GY-521 motion/ });
  await expect(row).toContainText(/Input 1 · I2C · Tilt X/);
  await expect(page.getByLabel("Keep Accel X (g)")).toHaveCount(0);
});

test("replacing a part keeps the metric it fed, and a metric no part feeds is tagged Not wired", async ({ page }) => {
  await page.goto("/templates/new");
  await page.getByLabel("Template name").fill(`E2E replace ${Date.now()}`);
  await page.getByRole("button", { name: "Next: Hardware" }).click();
  await page.getByRole("button", { name: "Set up wiring" }).click();
  await page.getByRole("button", { name: "Add input" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Driver").selectOption({ label: "DHT22 / AM2302" });
  await sheet.getByLabel(/^Name of what Temperature .*feeds$/).fill("Air");

  // Replace part: a DS18B20's °C probe takes over the °C metric, name and all.
  await sheet.getByLabel("Driver").selectOption({ label: "DS18B20 temperature" });
  await expect(sheet.getByLabel(/^Name of what .*1.* feeds$/)).toHaveValue("Air");
  await sheet.getByRole("button", { name: "Done" }).click();

  // A metric typed in by hand, that no part feeds.
  await page.getByRole("button", { name: "Next: Data" }).click();
  await page.getByRole("button", { name: "Add metric" }).click();
  await expect(page.getByRole("dialog").getByText("Not wired")).toBeVisible();
});

test("editing a template: tabs in the URL, a row edited in its sheet, saved by the page", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId };
  const template = await (
    await request.post(`${API_URL}/catalog`, {
      headers,
      data: { name: `E2E tabs ${Date.now()}`, runs_on: "own_code", metrics: [{ name: "Flow", key: "flow" }] },
    })
  ).json();

  try {
    await page.goto(`/templates/${template.id}`);
    const tabs = page.getByRole("tablist", { name: "Device template sections" });
    // Custom firmware: no Wiring tab.
    await expect(tabs.getByRole("tab")).toHaveText(["General", "Data"]);
    await tabs.getByRole("tab", { name: "Data" }).click();
    await expect(page).toHaveURL(/\?tab=data$/);

    await page.getByRole("button", { name: /^Flow/ }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Name", { exact: true }).fill("Flow rate");
    await sheet.getByRole("button", { name: "Done" }).click();
    // The sheet has no save of its own; the page's save bar does.
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Template saved")).toBeVisible();
    const saved = await (await request.get(`${API_URL}/catalog/${template.id}`, { headers })).json();
    expect(saved.metrics[0].name).toBe("Flow rate");

    // A reload keeps the tab.
    await page.reload();
    await expect(tabs.getByRole("tab", { name: "Data" })).toHaveAttribute("aria-selected", "true");
  } finally {
    await request.delete(`${API_URL}/catalog/${template.id}`, { headers });
  }
});
