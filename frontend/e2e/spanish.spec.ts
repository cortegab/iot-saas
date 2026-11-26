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
      // Shared wording (statuses) follows the language too.
      await expect(page.getByText("Nunca conectado").first()).toBeVisible();

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

test.describe("Add device, in Spanish", () => {
  test.use({ locale: "es-MX" });

  test("speaks Spanish from the start choice to Create", async ({ page, request }) => {
    await resetChoice(request);
    await page.goto("/devices/new");
    await expect(page.getByRole("heading", { name: "Agregar dispositivo" })).toBeVisible();
    const start = page.getByRole("radiogroup", { name: "Cómo empezar" });
    await expect(start.getByRole("radio", { name: /Con una plantilla/ })).toBeVisible();
    await expect(start.getByRole("radio", { name: /Algo nuevo/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Crear dispositivo" })).toBeVisible();
  });
});

test.describe("templates and zones, in Spanish", () => {
  test.use({ locale: "es-MX" });

  test("list, new-template wizard and zones speak Spanish", async ({ page, request }) => {
    await resetChoice(request);
    await page.goto("/templates");
    await expect(page.getByRole("heading", { name: "Plantillas de dispositivo" })).toBeVisible();
    await page.goto("/templates/new");
    await expect(page.getByRole("heading", { name: "Nueva plantilla de dispositivo" })).toBeVisible();
    await expect(page.getByText("Nombra la plantilla")).toBeVisible();
    await expect(page.getByRole("radio", { name: /Nuestro firmware/ })).toBeVisible();
    await page.goto("/zones");
    await expect(page.getByRole("heading", { name: "Zonas" })).toBeVisible();
  });
});

test.describe("editors, in Spanish", () => {
  test.use({ locale: "es-MX" });

  test("invite, new API key and new dashboard speak Spanish", async ({ page, request }) => {
    await resetChoice(request);
    await page.goto("/members/invite");
    await expect(page.getByRole("heading", { name: "Invitar a un miembro" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar invitación" })).toBeVisible();
    await page.goto("/keys/new");
    await expect(page.getByRole("heading", { name: "Nueva API key" })).toBeVisible();
    await expect(page.getByLabel("Vence")).toBeVisible();
    await page.goto("/dashboards/new");
    await expect(page.getByRole("heading", { name: "Nuevo dashboard" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Crear dashboard" })).toBeVisible();
  });
});

test.describe("signed out, a Spanish browser", () => {

  test("gets the landing page and sign-in in Spanish", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "es-AR" });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Tus sensores reportan.");
    await expect(page).toHaveTitle(/sensores que reportan/);
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await expect(page.getByLabel("Correo electrónico")).toBeVisible();
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Crea tu cuenta" })).toBeVisible();
    await ctx.close();
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
