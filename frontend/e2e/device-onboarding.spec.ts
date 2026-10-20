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
    await page.getByRole("button", { name: /Our firmware/ }).click();
    await expect(page).toHaveURL(/from=new&runs=generic/);
    await page.getByLabel("Device name").fill(name);
    // The template is named after the device, out of view.
    await expect(page.getByLabel("Template name")).toHaveCount(0);

    // A DHT22 brings temperature and humidity; a relay an on/off actuator.
    await page.getByRole("button", { name: "Add input" }).click();
    await page.getByLabel("Driver").first().selectOption({ label: "DHT22 / AM2302" });
    await page.getByRole("button", { name: "Add output" }).click();
    // Named right on the part card.
    await page.getByLabel(/^Name of what Temperature .*feeds$/).fill("Air temperature");
    await expect(page.locator("p", { hasText: /What you.ll see:/ })).toContainText("Air temperature");

    await page.getByRole("button", { name: "Create device" }).click();
    await expect(page).toHaveURL(/\/devices\/[0-9a-f-]{36}\/connect$/);
    // Wired, so the Connect flow installs from the browser, no sketch.
    await expect(page.getByText("Over USB, from here")).toBeVisible();
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
    await page.getByRole("button", { name: /Custom firmware/ }).click();
    await expect(page).toHaveURL(/runs=own/);
    await page.getByLabel("Device name").fill(name);
    await expect(page.getByRole("heading", { level: 3, name: "Wiring", exact: true })).toHaveCount(0);
    await page.getByLabel("Name", { exact: true }).fill("Flow rate");

    await page.getByRole("button", { name: "Create device" }).click();
    await expect(page).toHaveURL(/\/devices\/[0-9a-f-]{36}\/connect$/);
    await expect(page.getByText("Download and upload")).toBeVisible();
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
  await expect(page.getByRole("heading", { level: 3, name: "Wiring", exact: true })).toBeVisible();
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
    await page.getByLabel("Name", { exact: true }).fill("Flow");
    await page.getByLabel(/^Key/).fill(key);
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
