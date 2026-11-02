import { expect, test } from "@playwright/test";
import { API_URL, landed } from "./fixtures";

// DESIGN.md §10.2 Welcome: someone new to a workspace (no dashboard there)
// lands on it once; Build my dashboard makes one from the devices, sets it as
// their default, and from then on that's where they land.

test("a new member is welcomed, builds a dashboard, and lands on it next time", async ({ page, request }) => {
  const stamp = Date.now();
  const password = "hunter2hunter2";
  const owner = (await (
    await request.post(`${API_URL}/auth/register`, { data: { email: `e2e-wowner-${stamp}@example.com`, password, tenant_name: `E2E Welcome ${stamp}` } })
  ).json()) as { access_token: string; memberships: { tenant_id: string }[] };
  const tenantId = owner.memberships[0].tenant_id;
  const headers = { Authorization: `Bearer ${owner.access_token}`, "X-Tenant-Id": tenantId };
  const catalog = (await (await request.get(`${API_URL}/catalog`, { headers })).json()) as { id: string }[];
  const made = await request.post(`${API_URL}/devices`, { headers, data: { name: "E2E bay1", catalog_entry_id: catalog[0].id } });
  expect(made.ok(), await made.text()).toBeTruthy();

  const email = `e2e-wmember-${stamp}@example.com`;
  expect((await request.post(`${API_URL}/auth/register`, { data: { email, password, tenant_name: `E2E Own ${stamp}` } })).ok()).toBeTruthy();
  expect((await request.post(`${API_URL}/tenants/members`, { headers, data: { email, role: "viewer" } })).ok()).toBeTruthy();

  const signIn = async () => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("list", { name: "Workspaces" }).getByRole("button", { name: new RegExp(`E2E Welcome ${stamp}`) }).click();
    await landed(page);
  };

  await signIn();
  await expect(page).toHaveURL("/welcome");
  await expect(page.getByRole("heading", { name: `Welcome to E2E Welcome ${stamp}`, level: 1 })).toBeVisible();
  await expect(page.getByText("You're in as Viewer.")).toBeVisible();
  await expect(page.getByText(/1 device · 0 rules/)).toBeVisible();

  await page.getByRole("button", { name: "Build my dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboards\/[0-9a-f-]{36}$/);
  const dashboard = new URL(page.url()).pathname;
  await expect(page.getByText("Default", { exact: true })).toBeVisible();
  await expect(page.getByText("E2E bay1").first()).toBeVisible();

  // Welcomed once: the next sign-in lands on the dashboard.
  await page.context().clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await signIn();
  await expect(page).toHaveURL(dashboard);
});
