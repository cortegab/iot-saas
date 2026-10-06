import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("sentence chips edit the threshold and hold in place, and the save toast lists the changes", async ({ page, ruleUnderTest }) => {
  await page.goto(`/rules/${ruleUnderTest.id}`);
  const sentence = page.getByLabel("Rule sentence");

  // The condition chip: change the value, Apply.
  await sentence.getByRole("button", { name: new RegExp(`= 1$`) }).click();
  const pop = page.getByRole("dialog", { name: "Edit phrase" });
  await pop.getByLabel("Value").fill("2");
  await pop.getByRole("button", { name: "Apply" }).click();
  await expect(sentence.getByRole("button", { name: /= 2$/ })).toBeVisible();

  // The hold chip; Esc cancels and returns focus to the chip.
  const hold = sentence.getByRole("button", { name: /^\d+ s$/ });
  await hold.click();
  await page.keyboard.press("Escape");
  await expect(hold).toBeFocused();
  await hold.click();
  await pop.getByLabel("Hold time (seconds)").fill("15");
  await pop.getByRole("button", { name: "Apply" }).click();
  await expect(sentence.getByRole("button", { name: "15 s" })).toBeVisible();

  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/2 changes: Condition changed; Hold for: .* → 15 s/)).toBeVisible();
});
