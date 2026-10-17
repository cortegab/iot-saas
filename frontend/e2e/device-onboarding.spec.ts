import { API_URL, expect, login, test } from "./fixtures";

test("a device from the hardware: its parts make the template, and it lands on Install", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId };
  const name = `E2E hw ${Date.now()}`;
  let deviceId: string | undefined;

  try {
    await page.goto("/devices/new");
    await page.getByRole("radio", { name: "From the hardware" }).click();
    await expect(page).toHaveURL(/from=hardware/);
    await page.getByLabel("Device name").fill(name);
    // The template name follows the device name until edited.
    await expect(page.getByLabel("Template name")).toHaveValue(name);

    // A DHT22 brings temperature and humidity; a relay an on/off actuator.
    await page.getByRole("button", { name: "Add input" }).click();
    await page.getByLabel("Driver").first().selectOption({ label: "DHT22 / AM2302" });
    await page.getByRole("button", { name: "Add output" }).click();

    await page.getByRole("button", { name: "Create device" }).click();
    await expect(page).toHaveURL(/\/devices\/[0-9a-f-]{36}\/connect$/);
    // Wired, so the Connect flow installs from the browser, no sketch.
    await expect(page.getByText("Over USB, from here")).toBeVisible();
    deviceId = page.url().match(/devices\/([0-9a-f-]{36})/)![1];

    const device = await (await request.get(`${API_URL}/devices/${deviceId}`, { headers })).json();
    const template = await (await request.get(`${API_URL}/catalog/${device.catalog_entry_id}`, { headers })).json();
    expect(template.name).toBe(name);
    expect(template.metrics.map((m: { key: string; unit: string | null }) => [m.key, m.unit])).toEqual([
      ["temperature", "°C"],
      ["humidity", "%"],
    ]);
    expect(template.actuators.map((a: { key: string }) => a.key)).toEqual(["relay"]);
    expect(template.hardware.inputs[0].channels).toEqual({ temperature: "temperature", humidity: "humidity" });
    expect(template.hardware.outputs[0].channels).toEqual({ value: "relay" });
  } finally {
    if (deviceId) {
      const device = await (await request.get(`${API_URL}/devices/${deviceId}`, { headers })).json();
      await request.delete(`${API_URL}/devices/${deviceId}`, { headers });
      await request.delete(`${API_URL}/catalog/${device.catalog_entry_id}`, { headers });
    }
  }
});
