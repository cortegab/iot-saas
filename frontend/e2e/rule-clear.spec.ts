import { test, expect } from "./fixtures";

test("a clear notification is configured in the form, summarised, and persisted", async ({
  page,
  ruleUnderTest,
}) => {
  await page.goto(`/rules/${ruleUnderTest.id}`);
  await page.getByRole("radiogroup", { name: "Editor view" }).getByRole("radio", { name: "Form" }).click();

  await expect(page.getByText("When the condition clears")).toBeVisible();
  // The fixture's only action is a notification — there's no actuator to turn back.
  await expect(page.getByLabel("Turn it back when the condition clears")).toHaveCount(0);

  // An on/off setting is a Switch (DESIGN.md §5), not a checkbox.
  const notify = page.getByRole("switch", { name: "Send a notification when it clears" });
  await notify.click();
  await expect(notify).toBeChecked();
  await page.getByLabel("Clear message").fill("E2E fixture cleared");
  await page.getByLabel("Clear delay (s)").fill("5");

  await expect(page.getByText(/when that's no longer true for 5s/)).toBeVisible();

  await page.getByRole("button", { name: "Save changes" }).click();
  // The rule is live: confirm.
  await page.getByRole("alertdialog").getByRole("button", { name: "Save changes" }).click();
  // The editor stays on the rule after saving (DESIGN.md §7).
  await expect(page.getByText("All changes saved")).toBeVisible();
  await expect(page).toHaveURL(`/rules/${ruleUnderTest.id}`);

  await page.reload();
  await expect(page.getByRole("switch", { name: "Send a notification when it clears" })).toBeChecked();
  await expect(page.getByLabel("Clear message")).toHaveValue("E2E fixture cleared");
  await expect(page.getByLabel("Clear delay (s)")).toHaveValue("5");
});
