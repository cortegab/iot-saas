import { test, expect } from "./fixtures";

test("a clear notification is configured in the form, summarised, and persisted", async ({
  page,
  ruleUnderTest,
}) => {
  await page.goto(`/rules/${ruleUnderTest.id}`);

  await expect(page.getByRole("heading", { name: "When the condition clears" })).toBeVisible();
  // The fixture's action is a notification, so "command on clear" is unavailable.
  await expect(page.getByLabel(/Send a device command when it clears/)).toBeDisabled();

  await page.getByLabel("Send a notification when it clears").check();
  await page.getByLabel("Clear message").fill("E2E fixture cleared");
  await page.getByLabel("Clear delay (s)").fill("5");

  await expect(page.getByText(/when that's no longer true for 5s/)).toBeVisible();

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL("/rules");

  await page.goto(`/rules/${ruleUnderTest.id}`);
  await expect(page.getByLabel("Send a notification when it clears")).toBeChecked();
  await expect(page.getByLabel("Clear message")).toHaveValue("E2E fixture cleared");
  await expect(page.getByLabel("Clear delay (s)")).toHaveValue("5");
});
