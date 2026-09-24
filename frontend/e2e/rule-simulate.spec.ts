import { test, expect } from "./fixtures";

test("simulate reflects live (missing) data, then an override that satisfies the condition", async ({
  page,
  ruleUnderTest,
}) => {
  await page.goto(`/rules/${ruleUnderTest.id}?tab=simulate`);

  const runButton = page.getByRole("button", { name: "Run simulation" });

  await runButton.click();
  await expect(page.getByText("Would not fire")).toBeVisible();
  await expect(page.getByText("no data (missing)")).toBeVisible();

  await page.getByRole("button", { name: "What if…" }).click();
  await page.getByLabel(ruleUnderTest.metric).fill("1");
  await runButton.click();

  await expect(page.getByText("Would fire", { exact: true })).toBeVisible();
});
