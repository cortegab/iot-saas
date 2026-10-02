import { expect } from "@playwright/test";
import { API_URL, test } from "./fixtures";

test("api keys: create, authenticate with it, then revoke", async ({ page, request }) => {
  const name = `E2E key ${Date.now()}`;
  await page.goto("/keys");
  await page.locator("header").getByRole("link", { name: "New API key" }).click();
  await expect(page).toHaveURL("/keys/new");
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Expires").selectOption("30");
  await page.getByRole("button", { name: "Create key" }).click();

  const secret = page.getByRole("region", { name: "One-time secret" });
  await secret.getByRole("button", { name: "Show" }).click();
  const key = (await secret.locator("dd").first().innerText()).trim();
  expect(key).toMatch(/^iot_/);
  await secret.getByLabel("I've stored it").check();
  await secret.getByRole("button", { name: "Done" }).click();

  // The key names its own workspace: no X-Tenant-Id needed.
  const ok = await request.get(`${API_URL}/devices`, { headers: { Authorization: `Bearer ${key}` } });
  expect(ok.status()).toBe(200);

  // Acknowledging the secret opens the key's page.
  await expect(page).toHaveURL(/\/keys\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.getByRole("button", { name: "Revoke key" }).click();
  await page.getByRole("button", { name: "Revoke key" }).last().click();
  await expect(page.getByText("Key revoked", { exact: true })).toBeVisible();

  const refused = await request.get(`${API_URL}/devices`, { headers: { Authorization: `Bearer ${key}` } });
  expect(refused.status()).toBe(401);
});
