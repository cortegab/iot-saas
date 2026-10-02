import { expect, test as base } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

test("members: invite someone, resend the invite, then cancel it", async ({ page, request }) => {
  // Cancel leftovers from an earlier interrupted run on the shared dev tenant.
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  const pending = (await (await request.get(`${API_URL}/tenants/invitations`, { headers })).json()) as { id: string; email: string }[];
  for (const inv of pending.filter((i) => i.email.startsWith("e2e-invite-"))) {
    await request.delete(`${API_URL}/tenants/invitations/${inv.id}`, { headers });
  }

  const email = `e2e-invite-${Date.now()}@example.com`;
  await page.goto("/members");
  await page.locator("header").getByRole("link", { name: "Invite member" }).click();
  await expect(page).toHaveURL("/members/invite");
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Email").fill(email);
  await page.getByRole("radio", { name: /Admin/ }).check();
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invite sent", { exact: true })).toBeVisible();

  // Back on the list, peeking the new invite.
  await expect(page).toHaveURL(/\/members\?peek=invite\./);
  await expect(page.getByRole("region", { name: `${email} details` }).getByText("They join when they open the link in their email.")).toBeVisible();

  const table = page.getByRole("table", { name: "Members" });
  const row = table.getByRole("row").filter({ hasText: email });
  await expect(row.getByText("Invited")).toBeVisible();

  await row.getByRole("button", { name: `Actions for ${email}` }).click();
  await page.getByRole("menuitem", { name: "Resend invite" }).click();
  await expect(page.getByText("Invite resent", { exact: true })).toBeVisible();

  await row.getByRole("button", { name: `Actions for ${email}` }).click();
  await page.getByRole("menuitem", { name: "Cancel invite…" }).click();
  await page.getByRole("button", { name: "Cancel invite" }).click();
  await expect(page.getByText("Invite cancelled", { exact: true })).toBeVisible();
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
