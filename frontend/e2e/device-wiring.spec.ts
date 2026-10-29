import { API_URL, expect, login, test } from "./fixtures";

const HARDWARE = {
  board: "esp32-devkit-30",
  i2c: null,
  inputs: [{ driver: "digital_in", pins: { pin: 13 }, params: { pull: "up" }, channels: { value: "door" } }],
  outputs: [{ driver: "relay", pins: { pin: 23 }, params: {}, channels: { value: "fan1" } }],
};

test("a device gets its own wiring and goes back to the template's", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId };
  const stamp = Date.now();
  const template = await (
    await request.post(`${API_URL}/catalog`, {
      headers,
      data: {
        name: `E2E wiring ${stamp}`,
        metrics: [{ name: "Door", key: "door", data_type: "bool" }],
        actuators: [{ name: "Fan", key: "fan1" }],
        hardware: HARDWARE,
      },
    })
  ).json();
  const { device } = await (
    await request.post(`${API_URL}/devices`, { headers, data: { name: `E2E wiring ${stamp}`, catalog_entry_id: template.id } })
  ).json();
  const ownWiring = async () => (await (await request.get(`${API_URL}/devices/${device.id}`, { headers })).json()).hardware;

  try {
    // The Connect flow's "Wire this device differently" lands on the section.
    await page.goto(`/devices/${device.id}?tab=settings#hardware`);
    await expect(page.getByRole("heading", { level: 2, name: "Wiring", exact: true })).toBeInViewport();

    // Starts on the template's wiring; a copy becomes this device's own.
    await page.getByRole("button", { name: "Wire this device differently" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(ownWiring).toMatchObject({ board: HARDWARE.board });
    await expect(page.getByRole("button", { name: `Save to ${template.name}…` })).toBeVisible();

    // Back on the template's: the copy is dropped.
    await page.getByRole("button", { name: "Use the template's wiring" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(ownWiring).toBeNull();
    await expect(page.getByRole("button", { name: "Wire this device differently" })).toBeVisible();
  } finally {
    await request.delete(`${API_URL}/devices/${device.id}`, { headers });
    await request.delete(`${API_URL}/catalog/${template.id}`, { headers });
  }
});
