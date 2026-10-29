import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

// DESIGN.md §5: a lasting state is said once in the header (not a callout,
// not a toast); a state that changes while the page is open gets one toast.

test("a device going online and offline while its page is open: one toast each, no offline callout", async ({ page, request }) => {
  test.setTimeout(60_000);
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  const tenant = await (await request.get(`${API_URL}/tenants/current`, { headers })).json();
  const stamp = Date.now();
  const tpl = await (
    await request.post(`${API_URL}/catalog`, { headers, data: { name: `E2E state ${stamp}`, runs_on: "own_code", metrics: [{ name: "Temp", key: "temp" }] } })
  ).json();
  const name = `E2E state ${stamp}`;
  const created = await (await request.post(`${API_URL}/devices`, { headers, data: { name, catalog_entry_id: tpl.id } })).json();
  const device = created.device as { id: string; slug: string };
  const status = (online: boolean) =>
    execFileSync("mosquitto_pub", [
      "-h", "localhost", "-p", "1883", "-u", device.id, "-P", created.credential.password,
      "-t", `${tenant.slug}/${device.slug}/status`, "-m", JSON.stringify({ online, uptime_s: 5 }),
    ]);

  try {
    await page.goto(`/devices/${device.id}`);
    // Never connected: the callout holds the next step (Connect it).
    await expect(page.getByText("Waiting for its first message.")).toBeVisible();
    // Nothing changed yet, so no toast on load.
    await expect(page.getByText(`${name} is online`)).toHaveCount(0);

    status(true);
    await expect(page.getByText(`${name} is online`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Waiting for its first message.")).toHaveCount(0);

    status(false);
    await expect(page.getByText(`${name} went offline`)).toBeVisible({ timeout: 15_000 });
    // Said once, in the header; no "Offline since …" callout on the Overview.
    await expect(page.getByText(/Offline since/)).toHaveCount(0);

    // Reloaded while offline: the header says it, and no toast repeats it.
    await page.reload();
    await expect(page.getByText(/last message/)).toBeVisible();
    await expect(page.getByText(`${name} went offline`)).toHaveCount(0);
  } finally {
    await request.delete(`${API_URL}/devices/${device.id}`, { headers });
    await request.delete(`${API_URL}/catalog/${tpl.id}`, { headers });
  }
});
