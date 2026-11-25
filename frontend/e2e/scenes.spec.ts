import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

// Ease-of-use C5: a manual rule opened to clients is a scene, a button above
// every dashboard that runs it after asking.
test("a manual rule made a scene runs from a dashboard's Scenes row", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { authorization: `Bearer ${accessToken}`, "x-tenant-id": tenantId };
  const stamp = Date.now();
  const rule = await (
    await request.post(`${API_URL}/rules`, {
      headers,
      data: { name: `E2E scene ${stamp}`, trigger: { type: "manual" }, actions: [{ type: "notification", message: "Night mode on", channels: ["platform"] }] },
    })
  ).json();
  const dashboard = await (await request.post(`${API_URL}/dashboards`, { headers, data: { name: `E2E scenes ${stamp}` } })).json();
  try {
    // The rule page's Basics opens it to clients.
    await page.goto(`/rules/${rule.id}`);
    await page.getByRole("switch", { name: "Scene" }).click();
    await expect(page.getByText("It's a scene now")).toBeVisible();

    await page.goto(`/dashboards/${dashboard.id}`);
    const scenes = page.getByRole("region", { name: "Scenes" });
    await scenes.getByRole("button", { name: `E2E scene ${stamp}` }).click();
    const ask = page.getByRole("alertdialog");
    await expect(ask).toContainText(`Run E2E scene ${stamp}?`);
    await ask.getByRole("button", { name: "Run it" }).click();
    await expect(page.getByText(`E2E scene ${stamp} is running`)).toBeVisible();
  } finally {
    await request.delete(`${API_URL}/rules/${rule.id}`, { headers });
    await request.delete(`${API_URL}/dashboards/${dashboard.id}`, { headers });
  }
});
