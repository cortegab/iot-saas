import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("a device's label link opens it, and Settings offers the label", async ({ page }) => {
  await page.goto("/devices");
  const row = page.getByRole("table", { name: "Devices" }).locator("tbody tr").first();
  await row.locator("td").nth(-2).click();
  await expect(page).toHaveURL(/peek=[0-9a-f-]{36}/);
  const id = new URL(page.url()).searchParams.get("peek")!;

  // /d/<id> is what the label's QR holds: it lands on the device page.
  await page.goto(`/d/${id}`);
  await expect(page).toHaveURL(new RegExp(`/devices/${id}$`), { timeout: 30_000 });

  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText("A QR that opens this device. It holds no password.")).toBeVisible();
  const label = page.getByText("A QR that opens this device.").locator("..");
  await expect(label.getByRole("button", { name: "Print label" })).toBeVisible();
  const download = page.waitForEvent("download");
  await label.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toMatch(/-label\.svg$/);
});

test("the Android app-links file is served as JSON", async ({ request }) => {
  const res = await request.get("/.well-known/assetlinks.json");
  expect(res.ok()).toBe(true);
  expect(Array.isArray(await res.json())).toBe(true);
});
