import { expect, test } from "@playwright/test";

const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";

// Signed-out pages: the plain Playwright `test`, not the login fixture.
test("sign in: generic error, show/hide password, then a workspace choice", async ({ page, request }) => {
  // An account with two workspaces (registration creates the first).
  const email = `e2e-two-ws-${Date.now()}@example.com`;
  const password = "hunter2hunter2";
  const reg = await request.post(`${API_URL}/auth/register`, { data: { email, password, tenant_name: "E2E First" } });
  expect(reg.ok(), await reg.text()).toBeTruthy();
  const { access_token } = await reg.json();
  const second = await request.post(`${API_URL}/tenants`, {
    headers: { Authorization: `Bearer ${access_token}` },
    data: { name: "E2E Second" },
  });
  expect(second.ok(), await second.text()).toBeTruthy();

  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  const pw = page.getByLabel("Password", { exact: true });

  // Show / Hide keeps the field's name.
  await pw.fill("wrong-password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(pw).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(pw).toHaveAttribute("type", "password");

  // One generic error, whatever was wrong.
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("That email and password don't match. Check both and try again.")).toBeVisible();

  await pw.fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const choices = page.getByRole("list", { name: "Workspaces" });
  await expect(page.getByRole("heading", { name: "Choose a workspace" })).toBeVisible();
  await choices.getByRole("button", { name: /E2E Second/ }).click();
  await expect(page).toHaveURL("/devices");
  await expect(page.getByRole("complementary", { name: "Primary" }).getByText("E2E Second")).toBeVisible();
});

test("sign in without 'Keep me signed in' keeps the session out of localStorage", async ({ page, request }) => {
  const email = `e2e-nokeep-${Date.now()}@example.com`;
  const password = "hunter2hunter2";
  const reg = await request.post(`${API_URL}/auth/register`, { data: { email, password, tenant_name: "E2E No Keep" } });
  expect(reg.ok(), await reg.text()).toBeTruthy();

  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Keep me signed in on this device").uncheck();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/devices");
  const stored = await page.evaluate(() => ({
    local: localStorage.getItem("iot-saas:refresh_token"),
    session: sessionStorage.getItem("iot-saas:refresh_token"),
  }));
  expect(stored.local).toBeNull();
  expect(stored.session).toBeTruthy();
});

test("register: the workspace is created with the account", async ({ page }) => {
  await page.goto("/register");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Workspace name").fill("E2E Register Co");
  await page.getByLabel("Email").fill(`e2e-reg-${Date.now()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("hunter2hunter2");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/devices");
});
