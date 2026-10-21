import type { APIRequestContext } from "@playwright/test";
import { API_URL, expect, login, test } from "./fixtures";

/** Deletes the device and the template onboarding made with it. */
async function cleanUp(request: APIRequestContext, headers: Record<string, string>, deviceId: string | undefined) {
  if (!deviceId) return;
  const device = await (await request.get(`${API_URL}/devices/${deviceId}`, { headers })).json();
  await request.delete(`${API_URL}/devices/${deviceId}`, { headers });
  await request.delete(`${API_URL}/catalog/${device.catalog_entry_id}`, { headers });
}

test("something new on our firmware: parts make the template, readings are named on the part, it lands on Install", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId };
  const name = `E2E hw ${Date.now()}`;
  let deviceId: string | undefined;

  try {
    await page.goto("/devices/new");
    await page.getByRole("radio", { name: "Something new" }).click();
    // Straight into the wizard, on our firmware (DESIGN.md §8, demo H).
    await expect(page).toHaveURL(/from=new/);
    await expect(page.getByRole("radio", { name: /^Our firmware/ })).toBeChecked();
    await page.getByLabel("Device name").fill(name);
    // The template is named after the device, out of view.
    await expect(page.getByLabel("Template name")).toHaveCount(0);

    await page.getByRole("button", { name: "Next: Hardware" }).click();

    // A DHT22 brings temperature and humidity; a relay an on/off actuator.
    // Each new part opens its sheet; its readings are named right there.
    await page.getByRole("button", { name: "Add input" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Driver").selectOption({ label: "DHT22 / AM2302" });
    await sheet.getByLabel(/^Name of what Temperature .*feeds$/).fill("Air temperature");
    await sheet.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Add output" }).click();
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("p", { hasText: /What you.ll see:/ })).toContainText("Air temperature");

    await page.getByRole("button", { name: "Next: Data" }).click();
    await page.getByRole("button", { name: "Next: Review" }).click();
    await page.getByRole("button", { name: "Create device" }).click();
    await expect(page).toHaveURL(/\/devices\/[0-9a-f-]{36}\/connect$/);
    // Wired, so the Connect flow installs from the browser, no sketch.
    await expect(page.getByRole("list", { name: "Steps" })).toContainText("Install");
    deviceId = page.url().match(/devices\/([0-9a-f-]{36})/)![1];

    const device = await (await request.get(`${API_URL}/devices/${deviceId}`, { headers })).json();
    const template = await (await request.get(`${API_URL}/catalog/${device.catalog_entry_id}`, { headers })).json();
    expect(template.name).toBe(name);
    expect(template.runs_on).toBe("generic_firmware");
    expect(template.metrics.map((m: { unit: string | null }) => m.unit)).toEqual(["°C", "%"]);
    expect(template.metrics[0].name).toBe("Air temperature");
    expect(template.actuators).toHaveLength(1);
    // JSONB doesn't keep key order.
    expect(Object.keys(template.hardware.inputs[0].channels).sort()).toEqual(["humidity", "temperature"]);
  } finally {
    await cleanUp(request, headers, deviceId);
  }
});

test("something new on its own code: no wiring, its data listed, it lands on the sketch", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId };
  const name = `E2E own ${Date.now()}`;
  let deviceId: string | undefined;

  try {
    await page.goto("/devices/new?from=new");
    await page.getByRole("radio", { name: /^Custom firmware/ }).click();
    await page.getByLabel("Device name").fill(name);
    await expect(page.getByRole("list", { name: "Steps" })).not.toContainText("Hardware");
    await page.getByRole("button", { name: "Next: Data" }).click();
    await page.getByRole("button", { name: /Unnamed/ }).click();
    await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Flow rate");
    await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Next: Review" }).click();

    await page.getByRole("button", { name: "Create device" }).click();
    await expect(page).toHaveURL(/\/devices\/[0-9a-f-]{36}\/connect$/);
    await expect(page.getByRole("list", { name: "Steps" })).toContainText("Flash");
    deviceId = page.url().match(/devices\/([0-9a-f-]{36})/)![1];

    const device = await (await request.get(`${API_URL}/devices/${deviceId}`, { headers })).json();
    const template = await (await request.get(`${API_URL}/catalog/${device.catalog_entry_id}`, { headers })).json();
    expect(template.runs_on).toBe("own_code");
    expect(template.hardware).toBeNull();
    expect(template.metrics.map((m: { key: string }) => m.key)).toEqual(["flow-rate"]);
  } finally {
    await cleanUp(request, headers, deviceId);
  }
});

test("older links to Add device from the hardware still start on our firmware", async ({ page }) => {
  await page.goto("/devices/new?from=hardware");
  await expect(page.getByRole("radio", { name: "Something new" })).toBeChecked();
  await expect(page.getByRole("list", { name: "Steps" })).toContainText("Hardware");
});

test("a new device just like an existing template offers that template, and uses it", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId };
  const stamp = Date.now();
  const key = `e2e-flow-${stamp}`;
  const template = await (
    await request.post(`${API_URL}/catalog`, { headers, data: { name: `E2E twin ${stamp}`, runs_on: "own_code", metrics: [{ name: "Flow", key }] } })
  ).json();
  let deviceId: string | undefined;

  try {
    await page.goto("/devices/new?from=new&runs=own");
    await page.getByLabel("Device name").fill(`E2E twin dev ${stamp}`);
    await page.getByRole("button", { name: "Next: Data" }).click();
    await page.getByRole("button", { name: /Unnamed/ }).click();
    await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Flow");
    await page.getByRole("dialog").getByLabel(/^Key/).fill(key);
    await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Next: Review" }).click();
    await page.getByRole("button", { name: "Create device" }).click();

    await expect(page.getByRole("alertdialog")).toContainText(`Matches ${template.name}`);
    await page.getByRole("button", { name: `Use ${template.name}` }).click();
    await expect(page).toHaveURL(/\/devices\/[0-9a-f-]{36}\/connect$/);
    deviceId = page.url().match(/devices\/([0-9a-f-]{36})/)![1];
    const device = await (await request.get(`${API_URL}/devices/${deviceId}`, { headers })).json();
    expect(device.catalog_entry_id).toBe(template.id);
  } finally {
    if (deviceId) await request.delete(`${API_URL}/devices/${deviceId}`, { headers });
    await request.delete(`${API_URL}/catalog/${template.id}`, { headers });
  }
});

test("add device starts as two cards; From a template says what the template gives you", async ({ page }) => {
  await page.goto("/devices/new");
  const start = page.getByRole("radiogroup", { name: "How to start" });
  await expect(start.getByRole("radio", { name: /^From a template/ })).toBeChecked();
  await expect(page.getByLabel("Device name")).toBeVisible();
  await expect(page.getByText("It gives you")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create device" })).toBeDisabled();

  // Something new: the wizard, with the same cards above its first question.
  await start.getByRole("radio", { name: /^Something new/ }).click();
  await expect(page).toHaveURL(/from=new/);
  await expect(page.getByRole("heading", { name: "What is it?" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Runs on" })).toBeVisible();
  // Regression: nothing typed yet, so no error yet (StrictMode once stole the name field's focus).
  await expect(page.getByText("Give the device a name.")).toHaveCount(0);
  await expect(page.getByLabel("Device name")).toBeFocused();
});
