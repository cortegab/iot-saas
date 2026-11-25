import { test, expect } from "./fixtures";

test("a rule referencing a metric with no telemetry shows the can't-evaluate badge", async ({
  page,
  ruleUnderTest,
}) => {
  await page.goto("/rules");

  const row = page.getByRole("row", { name: ruleUnderTest.name });
  await expect(row).toBeVisible();
  // One state per rule: Can't evaluate replaces Armed, and isn't repeated.
  await expect(row.getByText("Can't evaluate", { exact: true })).toHaveCount(1);
  await expect(row.getByText("Armed", { exact: true })).toHaveCount(0);
});
