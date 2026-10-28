import { test, expect } from "./fixtures";

test("preview: dry run reports missing data, and a tried value shows it would fire", async ({ page, ruleUnderTest }) => {
  await page.goto(`/rules/${ruleUnderTest.id}`);
  // The preview opens from its button, in a sheet (DESIGN.md §9.2).
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview" });

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
  await page.getByLabel("Name", { exact: true }).fill("E2E offline preview");
  await page.getByRole("button", { name: /Tell me when a device goes offline/ }).click();
  await page.getByLabel("Watched device").selectOption({ index: 1 });
  // Creating is a wizard (DESIGN.md §9.1): steps, and the first question.
  await expect(page.getByRole("list", { name: "Steps" })).toContainText("Review");
  await expect(page.getByRole("heading", { name: "What starts it?" })).toBeVisible();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Preview" });
  await expect(preview.getByText("Fires on each event, not on readings.")).toBeVisible();
  await expect(preview.getByText("Actions complete")).toBeVisible();
  await expect(preview.getByText(/^: (needs fixing|warning)$/)).toHaveCount(0);
});
