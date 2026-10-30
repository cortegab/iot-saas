import { expect, test } from "@playwright/test";
import { landed } from "./fixtures";

// DESIGN.md §10.x Get started: a new workspace's owner lands on it, each step
// read from data; dismissing it stops the landing for the whole workspace.

test("a new workspace lands on Get started; dismissing it lands elsewhere", async ({ page }) => {
  await page.goto("/register");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Workspace name").fill("E2E Setup Co");
  await page.getByLabel("Email").fill(`e2e-setup-${Date.now()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("hunter2hunter2");
  await page.getByRole("button", { name: "Create account" }).click();
  await landed(page);
  await expect(page).toHaveURL("/start");

  await expect(page.getByRole("heading", { name: "Get started", level: 1 })).toBeVisible();
  const steps = page.getByRole("list", { name: "Setup steps" }).getByRole("listitem");
  await expect(steps).toHaveCount(4);
  // Nothing has reported yet: the rule waits for a connected device.
  await expect(steps.nth(2)).toContainText("Needs a connected device");
  await expect(steps.nth(1).getByRole("link", { name: "Add device" })).toHaveAttribute("href", "/devices/new");
  await expect(page.getByRole("list", { name: "Optional steps" })).toContainText("Invite your team");

  await page.getByRole("button", { name: "I'll set it up myself" }).click();
  await expect(page.getByText("Get started dismissed")).toBeVisible();
  await landed(page);
  await expect(page).not.toHaveURL("/start");

  // Still reachable from Workspace settings.
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: "Open Get started" })).toHaveAttribute("href", "/start");
});
