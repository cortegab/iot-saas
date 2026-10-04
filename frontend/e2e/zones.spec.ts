import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

test("zones: create, rename and delete an empty zone on its page", async ({ page }) => {
  const name = `E2E zone ${Date.now()}`;
  await page.goto("/zones");
  // The page header's link; an empty list repeats it in its first-use state.
  await page.locator("header").getByRole("link", { name: "New zone" }).click();
  await expect(page).toHaveURL("/zones/new");
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create zone" }).click();
  await expect(page.getByText("Zone created")).toBeVisible();
  await expect(page).toHaveURL(/\/zones\/[0-9a-f-]{36}$/);

  await page.getByLabel("Name", { exact: true }).fill(`${name} renamed`);
  await page.keyboard.press("Control+s");
  await expect(page.getByText("Zone saved")).toBeVisible();

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("button", { name: "Delete zone" }).click();
  await expect(page.getByText(`${name} renamed deleted`)).toBeVisible();
  await expect(page).toHaveURL("/zones");
  await expect(page.getByRole("table", { name: "Zones" }).getByText(`${name} renamed`)).toHaveCount(0);
});

test("zones: delete from the list row's menu, same item as the peek and page", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  const name = `E2E row delete ${Date.now()}`;
  const res = await request.post(`${API_URL}/zones`, { headers, data: { name } });
  expect(res.ok()).toBeTruthy();
  const { id } = (await res.json()) as { id: string };
  try {
    await page.goto(`/zones?q=${encodeURIComponent(name)}`);
    const row = page.getByRole("table", { name: "Zones" }).getByRole("row").filter({ hasText: name });
    await row.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: /^Delete…/ }).click();
    await page.getByRole("button", { name: "Delete zone" }).click();
    await expect(page.getByText(`${name} deleted`)).toBeVisible();
    await expect(row).toHaveCount(0);
  } finally {
    await request.delete(`${API_URL}/zones/${id}`, { headers });
  }
});

test("lists peek: a drawer you can browse with ‹ › and ↓, Esc returns to the row, old ?edit links redirect", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  const stamp = Date.now();
  const made: string[] = [];
  for (const n of ["a", "b"]) {
    const res = await request.post(`${API_URL}/zones`, { headers, data: { name: `E2E peek ${stamp} ${n}`, notes: `note ${n}` } });
    expect(res.ok()).toBeTruthy();
    made.push(((await res.json()) as { id: string }).id);
  }
  try {
    await page.goto(`/zones?q=${encodeURIComponent(`E2E peek ${stamp}`)}`);
    const table = page.getByRole("table", { name: "Zones" });
    await table.getByRole("row").filter({ hasText: `E2E peek ${stamp} a` }).getByText("note a").click();

    // A drawer over the list: read-only, with its place in the list.
    const drawer = page.getByRole("dialog", { name: "Zone" });
    const peekA = drawer.getByRole("region", { name: `E2E peek ${stamp} a details` });
    await expect(peekA).toBeVisible();
    await expect(peekA.getByRole("textbox")).toHaveCount(0);
    await expect(peekA.getByRole("link", { name: /Edit zone|View zone/ })).toBeVisible();
    await expect(drawer.getByText("1 of 2")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`peek=${made[0]}`));

    // Browse without closing: ↓ (focus is in the drawer), then ‹ and ›.
    await page.keyboard.press("ArrowDown");
    await expect(drawer.getByRole("region", { name: `E2E peek ${stamp} b details` })).toBeVisible();
    await expect(drawer.getByText("2 of 2")).toBeVisible();
    await drawer.getByRole("button", { name: "Previous zone" }).click();
    await expect(drawer.getByRole("region", { name: `E2E peek ${stamp} a details` })).toBeVisible();
    await drawer.getByRole("button", { name: "Next zone" }).click();
    await expect(drawer.getByRole("region", { name: `E2E peek ${stamp} b details` })).toBeVisible();

    // Esc closes and lands on the row you browsed to; Enter peeks it again.
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(page.locator(`tr[data-row-key="${made[1]}"]`)).toBeFocused();
    await page.keyboard.press("Enter");
    await drawer.getByRole("link", { name: /Edit zone|View zone/ }).click();
    await expect(page).toHaveURL(`/zones/${made[1]}`);

    // A docked-editor-era link lands on the record's page.
    await page.goto(`/zones?edit=${made[0]}`);
    await expect(page).toHaveURL(`/zones/${made[0]}`);
  } finally {
    for (const id of made) await request.delete(`${API_URL}/zones/${id}`, { headers });
  }
});
