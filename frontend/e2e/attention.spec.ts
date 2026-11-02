import { expect, test } from "@playwright/test";
import { API_URL, landed } from "./fixtures";

// DESIGN.md §8 attention strip: above a dashboard, only when something needs
// someone; each item links to its filtered list.

test("a dashboard shows what needs attention, linked to its list, and nothing when all is well", async ({ page, request }) => {
  const stamp = Date.now();
  const email = `e2e-attn-${stamp}@example.com`;
  const password = "hunter2hunter2";
  const owner = (await (await request.post(`${API_URL}/auth/register`, { data: { email, password, tenant_name: `E2E Attention ${stamp}` } })).json()) as {
    access_token: string;
    memberships: { tenant_id: string }[];
  };
  const headers = { Authorization: `Bearer ${owner.access_token}`, "X-Tenant-Id": owner.memberships[0].tenant_id };
  const catalog = (await (await request.get(`${API_URL}/catalog`, { headers })).json()) as { id: string }[];
  const device = (await (await request.post(`${API_URL}/devices`, { headers, data: { name: "E2E bay1", catalog_entry_id: catalog[0].id } })).json()) as {
    device: { id: string };
  };
  const dash = (await (await request.post(`${API_URL}/dashboards`, { headers, data: { name: "E2E attention" } })).json()) as { id: string };

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await landed(page);

  // All quiet: no strip.
  await page.goto(`/dashboards/${dash.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E attention");
  await expect(page.getByRole("status", { name: "Needs attention" })).toHaveCount(0);

  // A rule on a reading nobody publishes can't evaluate.
  const rule = await request.post(`${API_URL}/devices/${device.device.id}/rules`, {
    headers,
    data: {
      condition: { kind: "leaf", metric: "e2e-never-published", operator: ">", rhs: { source: "static", value: 1 } },
      action: { type: "actuator_command", actuator: "fan1", value: true },
    },
  });
  expect(rule.ok(), await rule.text()).toBeTruthy();
  await page.reload();
  const strip = page.getByRole("status", { name: "Needs attention" });
  await expect(strip).toContainText("1 rule can't evaluate");
  await strip.getByRole("link", { name: "1 rule can't evaluate" }).click();
  await expect(page).toHaveURL(/\/rules\?state=stale$/);
});
