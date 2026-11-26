import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

// DESIGN.md §11a: Spanish when the browser is Spanish (any es-*), English by
// default, and a Language choice saved on the account that wins over both.

async function resetChoice(request: Parameters<typeof login>[0]) {
  const { accessToken, tenantId } = await login(request);
  await request.patch(`${API_URL}/auth/me`, {
    headers: { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId },
    data: { locale: null },
  });
  return { accessToken, tenantId };
}

test.describe("a Spanish browser", () => {
  test.use({ locale: "es-MX" });

  test("gets the shell in Spanish, and a saved choice wins and follows reloads", async ({ page, request }) => {
    const { accessToken, tenantId } = await resetChoice(request);
    try {
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.goto("/devices");
      await expect(page.locator("html")).toHaveAttribute("lang", "es");
      const nav = page.getByRole("navigation", { name: "Principal" });
      await expect(nav.getByRole("link", { name: /Dispositivos/ })).toBeVisible();
      await expect(nav.getByRole("link", { name: /Reglas/ })).toBeVisible();
      await expect(nav.getByText("Monitoreo")).toBeVisible();

      // Choose English in the account menu: applied at once and saved.
      await page.getByRole("button", { name: /Menú de cuenta/ }).click();
      await page.getByRole("menuitemradio", { name: "English" }).click();
      const enNav = page.getByRole("navigation", { name: "Main" });
      await expect(enNav.getByRole("link", { name: /Devices/ })).toBeVisible();
      await expect
        .poll(async () => (await (await request.get(`${API_URL}/auth/me`, { headers: { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId } })).json()).locale)
        .toBe("en");
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(enNav.getByRole("link", { name: /Devices/ })).toBeVisible();

      // Back to following the browser: Spanish again.
      await page.getByRole("button", { name: /Account menu/ }).click();
      await page.getByRole("menuitemradio", { name: "Browser default" }).click();
      await expect(nav.getByRole("link", { name: /Dispositivos/ })).toBeVisible();
    } finally {
      await resetChoice(request);
    }
  });
});

test.describe("a browser in a language we don't speak", () => {
  test.use({ locale: "fr-FR" });

  test("gets English", async ({ page, request }) => {
    await resetChoice(request);
    await page.goto("/devices");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Devices/ })).toBeVisible();
  });
});
