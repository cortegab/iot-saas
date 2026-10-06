import { test, expect } from "./fixtures";

test("a rule referencing a metric with no telemetry shows the can't-evaluate badge", async ({
  page,
  ruleUnderTest,
}) => {
  await page.goto("/rules");

  const row = page.getByRole("row", { name: ruleUnderTest.name });
  await expect(row).toBeVisible();
  await expect(row.getByText("Can't evaluate")).toBeVisible();
});
