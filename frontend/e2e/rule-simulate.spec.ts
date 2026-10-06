import { test, expect } from "./fixtures";

test("preview: dry run reports missing data, and a tried value shows it would fire", async ({ page, ruleUnderTest }) => {
  await page.goto(`/rules/${ruleUnderTest.id}`);
  const preview = page.getByRole("complementary", { name: "Preview" });

  // The fixture device never published this metric: unknown data never fires.
  await preview.getByRole("button", { name: "Dry run with live readings" }).click();
  await expect(preview.getByText(/Can't tell now: .*missing/)).toBeVisible();

  await preview.getByText("Try other values").click();
  await preview.getByPlaceholder("live value").first().fill("1");
  await expect(preview.getByText("With these values it would fire.")).toBeVisible();
});

test("new rule: a recipe opens the workbench with its checks passing", async ({ page }) => {
  await page.goto("/rules/new");
  await expect(page.getByRole("list", { name: "Recipes" })).toBeVisible();
  await page.getByRole("button", { name: /Tell me when this device goes offline/ }).click();
  // Step numbers show while creating.
  await expect(page.getByText("Step 1:")).toBeAttached();
  const preview = page.getByRole("complementary", { name: "Preview" });
  await expect(preview.getByText("Fires on each event, not on readings.")).toBeVisible();
  await expect(preview.getByText("Actions complete")).toBeVisible();
  await expect(preview.getByText(": fails")).toHaveCount(0);
});
