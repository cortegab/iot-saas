import { expect } from "@playwright/test";
import { API_URL, test } from "./fixtures";

test("api keys: create, authenticate with it, then revoke", async ({ page, request }) => {
  const name = `E2E key ${Date.now()}`;
  await page.goto("/keys");
  await page.locator("header").getByRole("button", { name: "New API key" }).click();

  const editor = page.getByRole("region", { name: /editor$/ });
  await editor.getByLabel("Name").fill(name);
  await editor.getByLabel("Expires").selectOption("30");
  await editor.getByRole("button", { name: "Create key" }).click();

  const secret = page.getByRole("region", { name: "One-time secret" });
  await secret.getByRole("button", { name: "Show" }).click();
  const key = (await secret.locator("dd").first().innerText()).trim();
  expect(key).toMatch(/^iot_/);
  await secret.getByLabel("I've stored it").check();
  await secret.getByRole("button", { name: "Done" }).click();

  // The key names its own workspace: no X-Tenant-Id needed.
  const ok = await request.get(`${API_URL}/devices`, { headers: { Authorization: `Bearer ${key}` } });
  expect(ok.status()).toBe(200);

  await expect(editor.getByRole("heading", { name })).toBeVisible();
  await editor.getByRole("button", { name: "Revoke key" }).click();
  await page.getByRole("button", { name: "Revoke key" }).last().click();
  await expect(page.getByText("Key revoked", { exact: true })).toBeVisible();

  const refused = await request.get(`${API_URL}/devices`, { headers: { Authorization: `Bearer ${key}` } });
  expect(refused.status()).toBe(401);
});
