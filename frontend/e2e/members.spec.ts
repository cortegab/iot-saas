import { expect, test as base } from "@playwright/test";
import { test } from "./fixtures";

test("members: invite someone, resend the invite, then cancel it", async ({ page }) => {
  const email = `e2e-invite-${Date.now()}@example.com`;
  await page.goto("/members");
  await page.getByRole("button", { name: "Invite member" }).click();

  const editor = page.getByRole("region", { name: /editor$/ });
  await editor.getByLabel("Email").fill(email);
  await editor.getByRole("radio", { name: /Admin/ }).check();
  await editor.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invite sent")).toBeVisible();

  const table = page.getByRole("table", { name: "Members" });
  const row = table.getByRole("row").filter({ hasText: email });
  await expect(row.getByText("Invited")).toBeVisible();

  await row.getByRole("button", { name: `Actions for ${email}` }).click();
  await page.getByRole("menuitem", { name: "Resend invite" }).click();
  await expect(page.getByText("Invite resent")).toBeVisible();

  await row.getByRole("button", { name: `Actions for ${email}` }).click();
  await page.getByRole("menuitem", { name: "Cancel invite…" }).click();
  await page.getByRole("button", { name: "Cancel invite" }).click();
  await expect(page.getByText("Invite cancelled")).toBeVisible();
  await expect(table.getByText(email)).toHaveCount(0);
});

// The fixture `test` signs in first; these need a signed-out page.
base.describe("signed out", () => {
  base("forgot password answers the same for any email", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL("/forgot-password");
    // A dev-compiled route can hydrate after the first fill and wipe it.
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Email").fill(`nobody-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  });

  base("an unknown invitation link explains itself", async ({ page }) => {
    await page.goto("/invite/not-a-real-token");
    await expect(page.getByRole("heading", { name: "This invitation can't be used" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to sign in" })).toBeVisible();
  });
});
