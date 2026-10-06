import { execFileSync } from "node:child_process";
import { expect, type APIRequestContext } from "@playwright/test";
import { test as withLogin } from "./fixtures";

const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";
const PROV_SERVICE_UUID = "6e1f0001-7c3a-4b8e-9d2f-5a4b3c2d1e0f";

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

test("connect flow: create the credential, then the sketch embeds it", async ({ page, throwawayDevice }) => {
  await page.goto(`/devices/${throwawayDevice.id}/connect`);
  // Never connected → no confirm; the button creates the first credential.
  await page.getByRole("button", { name: "Create credential" }).click();

  const reveal = page.getByRole("region", { name: "One-time secret" });
  await expect(reveal.getByText(throwawayDevice.id, { exact: true })).toBeVisible();
  await reveal.getByRole("button", { name: "Show" }).click();
  const password = (await reveal.locator("dd").nth(1).innerText()).trim();
  expect(password.length).toBeGreaterThan(10);
  await reveal.getByLabel("I've stored it").check();
  await reveal.getByRole("button", { name: "Continue" }).click();

  // Step 2: the preview masks the password but carries everything else.
  const sketch = page.getByLabel("Generated sketch");
  await expect(sketch).toContainText(`MQTT_USERNAME = "${throwawayDevice.id}"`);
  await expect(sketch).toContainText('MQTT_PASSWORD = "••••••••"');
  await expect(sketch).not.toContainText(password);
  await expect(sketch).toContainText(PROV_SERVICE_UUID);
  await expect(sketch).toContainText("setBufferSize(1024)");
  await expect(sketch).toContainText("TOPIC_STATUS, 1, true");

  await page.getByRole("radio", { name: /Type it into the sketch/ }).check();
  await page.getByLabel("Network (2.4 GHz)").fill("bench-net");
  await expect(sketch).toContainText('DEV_WIFI_SSID = "bench-net"');

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Flash and Wi-Fi" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Live check" })).toBeVisible();
  await expect(page.getByText("Reached the broker")).toBeVisible();
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
    await page.getByRole("button", { name: "Live check" }).click();

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
