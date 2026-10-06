import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

test("rule versions: a rename shows up, and restoring v1 saves as v3", async ({ page, request, ruleUnderTest }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  const renamed = `${ruleUnderTest.name} (renamed)`;
  const patched = await request.patch(`${API_URL}/rules/${ruleUnderTest.id}`, { headers, data: { name: renamed } });
  expect(patched.ok()).toBeTruthy();

  await page.goto(`/rules/${ruleUnderTest.id}?tab=versions`);
  const versions = page.getByRole("list", { name: "Versions" });
  await expect(versions.getByText(`Renamed "${ruleUnderTest.name}" → "${renamed}"`)).toBeVisible();
  await expect(versions.getByText("Created")).toBeVisible();

  await versions.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Version 1 is loaded into the editor.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /name/i }).first()).toHaveValue(ruleUnderTest.name);
  await page.getByRole("button", { name: /^Save/ }).first().click();
  // The rule is live: confirm.
  await page.getByRole("alertdialog").getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  const list = await (await request.get(`${API_URL}/rules/${ruleUnderTest.id}/versions`, { headers })).json();
  expect(list[0].version).toBe(3);
  expect(list[0].change_lines).toContain(`Renamed "${renamed}" → "${ruleUnderTest.name}"`);
});
