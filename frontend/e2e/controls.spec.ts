import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

// DESIGN.md §8 controls: what was requested, then Waiting… (counting down
// the TTL), Acknowledged, or No response with Retry; offline sends warn
// first; the command timeline filters by result.

test("controls: warn when offline, count down, acknowledged by the device, then No response and Retry", async ({ page, request }) => {
  test.setTimeout(90_000);
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  const tenant = await (await request.get(`${API_URL}/tenants/current`, { headers })).json();
  const stamp = Date.now();
  const tpl = await (
    await request.post(`${API_URL}/catalog`, { headers, data: { name: `E2E controls ${stamp}`, runs_on: "own_code", actuators: [{ name: "Fan", key: "fan1" }] } })
  ).json();
  const created = await (await request.post(`${API_URL}/devices`, { headers, data: { name: `E2E controls ${stamp}`, catalog_entry_id: tpl.id } })).json();
  const device = created.device as { id: string; slug: string };
  const ack = (commandId: string) =>
    execFileSync("mosquitto_pub", [
      "-h", "localhost", "-p", "1883", "-u", device.id, "-P", created.credential.password,
      "-t", `${tenant.slug}/${device.slug}/ack/fan1`, "-m", JSON.stringify({ command_id: commandId }),
    ]);
  const latest = async () => (await (await request.get(`${API_URL}/devices/${device.id}/commands`, { headers })).json())[0] as { id: string };

  try {
    await page.goto(`/devices/${device.id}?tab=controls`);
    // Never connected, so offline: the send says so first.
    await page.getByRole("button", { name: "Turn On" }).click();
    const ask = page.getByRole("alertdialog");
    await expect(ask).toContainText("Send to an offline device?");
    await ask.getByRole("button", { name: "Turn On" }).click();
    // Accepted at once ("Sending…"), then the countdown once the worker has written it.
    await expect(page.getByText(/Sending…|Waiting for the device…/).first()).toBeVisible();
    await expect(page.getByText(/Waiting for the device… \d+ s/)).toBeVisible({ timeout: 15_000 });

    // The device acknowledges it.
    ack((await latest()).id);
    await expect(page.getByText("Acknowledged").first()).toBeVisible({ timeout: 15_000 });

    // Turned off, unanswered: No response once the 30 s TTL passes, then Retry.
    await page.getByRole("button", { name: "Turn Off" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Turn Off" }).click();
    await expect(page.getByText(/No response within 30 s\./)).toBeVisible({ timeout: 45_000 });
    await page.getByRole("button", { name: "Retry" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText(/Sending…|Waiting for the device…/).first()).toBeVisible();
    await expect(page.getByText(/Waiting for the device…/)).toBeVisible({ timeout: 15_000 });

    // The timeline filters by result.
    const timeline = page.getByRole("list", { name: "Commands" });
    await expect(timeline.getByRole("listitem")).toHaveCount(3);
    await page.getByRole("radiogroup", { name: "Result" }).getByRole("radio", { name: "Acknowledged" }).click();
    await expect(timeline.getByRole("listitem")).toHaveCount(1);
    await expect(timeline.getByRole("listitem")).toContainText("fan1 → On");
  } finally {
    await request.delete(`${API_URL}/devices/${device.id}`, { headers });
    await request.delete(`${API_URL}/catalog/${tpl.id}`, { headers });
  }
});
