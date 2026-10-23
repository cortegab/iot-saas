import { test, expect } from "./fixtures";

test("a clear notification is configured in the form, summarised, and persisted", async ({
  page,
  ruleUnderTest,
}) => {
  await page.goto(`/rules/${ruleUnderTest.id}`);
  await page.getByRole("radiogroup", { name: "Editor view" }).getByRole("radio", { name: "Form" }).click();
  // What happens on clear is part of Behaviour (DESIGN.md §9.2 tabs).
  await page.getByRole("tablist", { name: "Rule sections" }).getByRole("tab", { name: /^Behaviour/ }).click();

  const behaviour = page.getByRole("region", { name: "Behaviour" });
  // Re-arm or Latch as cards, and the safety timers (demo H).
  await expect(behaviour.getByRole("radiogroup", { name: "After it fires" }).getByRole("radio", { name: /Re-arm/ })).toBeChecked();
  // The fixture's only action is a notification — there's no actuator to turn back.
  await expect(page.getByLabel("Turn it back when the condition clears")).toHaveCount(0);

  // An on/off setting is a Switch (DESIGN.md §5), not a checkbox.
  const notify = page.getByRole("switch", { name: "Notify when it clears" });
  await notify.click();
  await expect(notify).toBeChecked();
  await behaviour.getByLabel("Message", { exact: true }).fill("E2E fixture cleared");
  await page.getByLabel(/^Clear delay/).fill("5");

  await expect(page.getByText(/when that's no longer true for 5s/)).toBeVisible();

  await page.getByRole("button", { name: "Save rule" }).click();
  // The rule is live: confirm.
  await page.getByRole("alertdialog").getByRole("button", { name: "Save rule" }).click();
  // The editor stays on the rule after saving (DESIGN.md §7).
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/rules/${ruleUnderTest.id}`);

  await page.reload();
  await expect(page.getByRole("switch", { name: "Notify when it clears" })).toBeChecked();
  await expect(page.getByRole("region", { name: "Behaviour" }).getByLabel("Message", { exact: true })).toHaveValue("E2E fixture cleared");
  await expect(page.getByLabel(/^Clear delay/)).toHaveValue("5");
});
