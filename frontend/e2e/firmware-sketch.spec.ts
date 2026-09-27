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

// Generating code rotates the credential — never point this at a real board.
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

test("generating onboarding code rotates the credential and embeds it", async ({
  page,
  throwawayDevice,
}) => {
  await page.goto(`/devices/${throwawayDevice.id}?tab=settings`);
  await page.getByRole("button", { name: "Generate onboarding code" }).click();
  await expect(page.getByText("Rotate credential?")).toBeVisible();
  await page.getByRole("button", { name: "Rotate and generate" }).click();

  const sketch = page.locator("pre code");
  await expect(sketch).toContainText(`MQTT_USERNAME = "${throwawayDevice.id}"`);
  await expect(sketch).not.toContainText("paste your device credential");
  await expect(sketch).toContainText(PROV_SERVICE_UUID);
  await expect(sketch).toContainText("setBufferSize(1024)");
  await expect(sketch).toContainText('TOPIC_STATUS, 1, true');

  // The Credential row shows the same freshly rotated secret the sketch embeds.
  const password = (await sketch.innerText()).match(/MQTT_PASSWORD = "([^"]+)"/)?.[1];
  expect(password).toBeTruthy();
  await expect(page.getByText(password!, { exact: true })).toBeVisible();
});
