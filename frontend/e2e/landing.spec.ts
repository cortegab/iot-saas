import { expect, test } from "@playwright/test";
import { API_URL, landed, login } from "./fixtures";

// DESIGN.md §4 Landing: every entry point goes through /home, which sends
// each person where they belong; a ?next= link skips it.

async function signIn(page: import("@playwright/test").Page, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("sign-in lands on the default dashboard, and a ?next= link still wins", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  const before = ((await (await request.get(`${API_URL}/dashboards`, { headers })).json()) as { id: string; is_default: boolean }[]).find((d) => d.is_default)?.id;
  const dash = (await (await request.post(`${API_URL}/dashboards`, { headers, data: { name: `E2E landing ${Date.now()}` } })).json()) as { id: string };
  await request.put(`${API_URL}/dashboards/${dash.id}/default`, { headers });

  try {
    await signIn(page);
    await landed(page);
    await expect(page).toHaveURL(`/dashboards/${dash.id}`);

    await page.context().clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await signIn(page, "/rules");
    await expect(page).toHaveURL("/rules");
  } finally {
    await request.delete(`${API_URL}/dashboards/${dash.id}`, { headers });
    if (before) await request.put(`${API_URL}/dashboards/${before}/default`, { headers });
  }
});
