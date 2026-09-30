import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("device editor docks beside the list, tracks unsaved changes and discards", async ({ page }) => {
  await page.goto("/devices");
  const firstRowMenu = page.getByRole("button", { name: /^Actions for / }).first();
  await firstRowMenu.click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(page).toHaveURL(/edit=/);

  const editor = page.getByRole("region", { name: /editor$/ });
  const name = editor.getByLabel("Name", { exact: true });
  const original = await name.inputValue();
  await name.fill(`${original} draft`);
  await expect(editor.getByText("Unsaved changes")).toBeVisible();

  await editor.getByRole("button", { name: "Discard" }).click();
  await expect(name).toHaveValue(original);
  await expect(editor.getByText("All changes saved")).toBeVisible();

  await editor.getByRole("button", { name: "Close device editor" }).click();
  await expect(page).not.toHaveURL(/edit=/);
});

test("devices list: KPI filter, chips and a search that matches nothing", async ({ page }) => {
  await page.goto("/devices");
  const table = page.getByRole("table", { name: "Devices" });
  await expect(table).toBeVisible();

  // A KPI tile toggles the status filter, mirrored in the URL and as a chip.
  const kpis = page.getByRole("group", { name: "Filter by status" });
  await kpis.getByRole("button", { name: /Offline/ }).click();
  await expect(page).toHaveURL(/status=offline/);
  await expect(page.getByText("Status: Offline")).toBeVisible();

  // Searching for nothing shows the no-results state with Clear filters.
  await page.getByRole("searchbox", { name: "Search name or template" }).fill("zz-no-such-device");
  await expect(page.getByRole("heading", { name: "No devices match these filters" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL("/devices");
  await expect(table).toBeVisible();
});
