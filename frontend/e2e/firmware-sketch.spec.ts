import { execFileSync } from "node:child_process";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { test as withLogin } from "./fixtures";

const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";
// The retired custom GATT service: no sketch may carry it any more.
const OLD_GATT_UUID = "6e1f0001-7c3a-4b8e-9d2f-5a4b3c2d1e0f";

async function apiHeaders(request: APIRequestContext) {
  const res = await request.post(`${API_URL}/auth/login`, {
    data: { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD },
  });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return {
    Authorization: `Bearer ${body.access_token}`,
    "X-Tenant-Id": body.memberships[0].tenant_id as string,
  };
}

// The connect flow rotates the credential — never point this at a real board.
const test = withLogin.extend<{ throwawayDevice: { id: string; name: string } }>({
  throwawayDevice: async ({ request }, use) => {
    const headers = await apiHeaders(request);
    const catalog = await (await request.get(`${API_URL}/catalog`, { headers })).json();
    const created = await request.post(`${API_URL}/devices`, {
      headers,
      data: { name: `E2E sketch ${Date.now()}`, catalog_entry_id: catalog[0].id },
    });
    expect(created.ok(), `POST /devices failed: ${created.status()}`).toBeTruthy();
    const device = (await created.json()).device;
    await use({ id: device.id, name: device.name });
    await request.delete(`${API_URL}/devices/${device.id}`, { headers });
  },
});

/** Reads the one-time credential and continues to Options; returns the password. */
async function storeCredential(page: Page, deviceId: string): Promise<string> {
  const reveal = page.getByRole("region", { name: "One-time secret" });
  await expect(reveal.getByText(deviceId, { exact: true })).toBeVisible();
  await reveal.getByRole("button", { name: "Show" }).click();
  const password = (await reveal.locator("dd").nth(1).innerText()).trim();
  expect(password.length).toBeGreaterThan(10);
  await reveal.getByLabel("I've stored it").check();
  await reveal.getByRole("button", { name: "Continue" }).click();
  return password;
}

/** A step in the connect flow's step rail. */
const stepButton = (page: Page, name: RegExp) => page.getByRole("list", { name: "Steps" }).getByRole("button", { name });

/** The QR payload, as Copy payload puts it on the clipboard. */
async function qrPayload(page: Page): Promise<Record<string, unknown>> {
  await page.getByRole("button", { name: "Copy payload" }).click();
  return JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
}

test("connect flow: phone provisioning with a QR from the credential, or typed Wi-Fi with no BLE at all", async ({ page, context, throwawayDevice }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/devices/${throwawayDevice.id}/connect`);
  // Never connected → no confirm; the button creates the first credential.
  await page.getByRole("button", { name: "Create credential" }).click();
  const password = await storeCredential(page, throwawayDevice.id);

  // Options: no code here; defaults are a phone and Security 2.
  await expect(page.getByRole("heading", { name: "Options" })).toBeVisible();
  await expect(page.getByLabel("Generated sketch")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /2 – SRP6a/ })).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();

  // Flash: download, plus a collapsed preview that masks the password.
  await expect(page.getByRole("heading", { name: "Flash" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Download .*\.ino/ })).toBeEnabled({ timeout: 10_000 });
  const sketch = page.getByLabel("Generated sketch");
  await expect(sketch).toBeHidden();
  await page.getByText("Preview the sketch").click();
  await expect(sketch).toContainText(`MQTT_USERNAME = "${throwawayDevice.id}"`);
  await expect(sketch).toContainText('MQTT_PASSWORD = "••••••••"');
  await expect(sketch).not.toContainText(password);
  await expect(sketch).toContainText("NETWORK_PROV_SECURITY_2, (const char*)&SEC2_PARAMS");
  await expect(sketch).toContainText("SEC2_VERIFIER");
  await expect(sketch).not.toContainText(OLD_GATT_UUID);
  await page.getByRole("button", { name: "Continue" }).click();

  // Wi-Fi from your phone: the QR is the device name + its credential.
  await expect(page.getByRole("heading", { name: "Wi-Fi from your phone" })).toBeVisible();
  await expect(page.getByRole("img", { name: `Provisioning QR for ${throwawayDevice.name}` })).toBeVisible();
  expect(await qrPayload(page)).toEqual({
    ver: "v1",
    name: throwawayDevice.name,
    username: throwawayDevice.id,
    pop: password,
    transport: "ble",
    network: "wifi",
    security: 2,
  });

  // Security 1: no username, the password is the PoP.
  await stepButton(page, /Options/).click();
  await page.getByRole("radio", { name: /1 – PoP/ }).check();
  await stepButton(page, /From your phone/).click();
  expect(await qrPayload(page)).toEqual({ ver: "v1", name: throwawayDevice.name, pop: password, transport: "ble", network: "wifi", security: 1 });

  // Typed Wi-Fi: no provisioning in the sketch, and step 4 is skipped.
  await stepButton(page, /Options/).click();
  await page.getByRole("radio", { name: /Type it into the sketch/ }).check();
  await page.getByLabel("Network (2.4 GHz)").fill("bench-net");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Preview the sketch").click();
  await expect(sketch).toContainText('WIFI_SSID = "bench-net"');
  await expect(sketch).not.toContainText("WiFiProv");
  await expect(sketch).not.toContainText("Huge APP");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Live check" })).toBeVisible();
  await expect(page.getByText("Reached the broker")).toBeVisible();
});

test("rotating the credential makes a new QR", async ({ page, context, throwawayDevice, request }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // Pretend the board has connected once, so Rotate asks first.
  await page.goto(`/devices/${throwawayDevice.id}/connect`);
  await page.getByRole("button", { name: "Create credential" }).click();
  const first = await storeCredential(page, throwawayDevice.id);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const before = await qrPayload(page);
  expect(before.pop).toBe(first);

  // A new credential (as a reflash would need) means a new QR.
  const rotated = await request.post(`${API_URL}/devices/${throwawayDevice.id}/rotate-credential`, { headers: await apiHeaders(request) });
  expect(rotated.ok()).toBeTruthy();
  await page.goto(`/devices/${throwawayDevice.id}/connect`);
  await page.getByRole("button", { name: "Create credential" }).click();
  const second = await storeCredential(page, throwawayDevice.id);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const after = await qrPayload(page);
  expect(after.pop).toBe(second);
  expect(after.pop).not.toBe(before.pop);
});

test("adding a device hands its credential straight to the connect flow", async ({ page, request }) => {
  const name = `E2E add ${Date.now()}`;
  await page.goto("/devices/new");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create and connect" }).click();
  await expect(page).toHaveURL(/\/devices\/[0-9a-f-]+\/connect$/);
  const deviceId = page.url().split("/devices/")[1].split("/")[0];
  try {
    // No rotate step: the credential from creation is already here.
    const reveal = page.getByRole("region", { name: "One-time secret" });
    await expect(reveal.getByText(deviceId, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create credential" })).toHaveCount(0);
  } finally {
    await request.delete(`${API_URL}/devices/${deviceId}`, { headers: await apiHeaders(request) });
  }
});

test("live check turns green as the board reports in", async ({ page, request }) => {
  const headers = await apiHeaders(request);
  const tenant = await (await request.get(`${API_URL}/tenants/current`, { headers })).json();
  const tpl = await (
    await request.post(`${API_URL}/catalog`, {
      headers,
      data: { name: `E2E live ${Date.now()}`, metrics: [{ key: "temperature", name: "Temperature", unit: "°C" }], actuators: [] },
    })
  ).json();
  const created = await (
    await request.post(`${API_URL}/devices`, { headers, data: { name: `E2E live ${Date.now()}`, catalog_entry_id: tpl.id } })
  ).json();
  const device = created.device as { id: string; slug: string };
  const pub = (topic: string, message: string) =>
    execFileSync("mosquitto_pub", ["-h", "localhost", "-p", "1883", "-u", device.id, "-P", created.credential.password, "-t", topic, "-m", message]);
  try {
    // A device created over the API has no handoff, so rotate here and use
    // the new password to publish as the board.
    await page.goto(`/devices/${device.id}/connect`);
    await page.getByRole("button", { name: "Create credential" }).click();
    const reveal = page.getByRole("region", { name: "One-time secret" });
    await reveal.getByRole("button", { name: "Show" }).click();
    created.credential.password = (await reveal.locator("dd").nth(1).innerText()).trim();
    await reveal.getByLabel("I've stored it").check();
    await reveal.getByRole("button", { name: "Continue" }).click();
    await stepButton(page, /Live check/).click();

    const broker = page.getByRole("listitem").filter({ hasText: "Reached the broker" });
    const reading = page.getByRole("listitem").filter({ hasText: "First reading: Temperature" });
    await expect(broker).toContainText("waiting");

    pub(`${tenant.slug}/${device.slug}/status`, JSON.stringify({ online: true, rssi: -61, fw_version: "1.0.0" }));
    await expect(broker).toContainText("done", { timeout: 10_000 });
    await expect(broker).toContainText("rssi -61 dBm");

    pub(`${tenant.slug}/${device.slug}/temperature`, JSON.stringify({ value: 21.5 }));
    await expect(reading).toContainText("done", { timeout: 10_000 });
    await expect(page.getByText(/is live\./).first()).toBeVisible();
  } finally {
    await request.delete(`${API_URL}/devices/${device.id}`, { headers });
    await request.delete(`${API_URL}/catalog/${tpl.id}`, { headers });
  }
});
