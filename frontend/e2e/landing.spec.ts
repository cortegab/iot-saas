import { expect, test } from "@playwright/test";

// The public page: signed out, no fixture login.
test("landing: sections in G's order, the tour switches, Talk to us sends", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your sensors report.");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/login");

  // Product tour tabs.
  await page.getByRole("tab", { name: "Rules" }).click();
  await expect(page.getByRole("heading", { name: "Rules you can read out loud" })).toBeVisible();

  // Onboarding illustrates its own steps; the control loop sits in How it works.
  await expect(page.locator("#onboarding").getByRole("img", { name: /^Onboarding example/ })).toBeVisible();
  await expect(page.locator('#how [aria-label="Example control loop"]')).toBeVisible();

  // Deployment → Talk to us (Dedicated cloud preselected).
  await page.getByRole("navigation", { name: "Page sections" }).getByRole("link", { name: "Deployment" }).click().catch(() => {});
  await page.locator("#deployment").getByRole("button", { name: "Talk to us" }).nth(1).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Interested in")).toHaveValue("dedicated");

  // Validation first, then a real send.
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByText("Tell us your name.")).toBeVisible();
  await dialog.getByLabel("Name").fill("E2E Visitor");
  await dialog.getByLabel("Work email").fill("e2e.visitor@example.com");
  await dialog.getByLabel("Company or site").fill("E2E Greenhouses");
  await dialog.getByRole("button", { name: "Send" }).click();
  // Five enquiries per hour per address: a rerun may meet the limit, which is
  // itself the designed answer.
  await expect(page.getByText(/Thanks, we've got it|Too many messages from here/)).toBeVisible();
});
