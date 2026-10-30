import type { BrowserContext, Page } from "@playwright/test";
import { API_URL, expect, landed, test } from "./fixtures";

// Refresh tokens rotate, and the API revokes the whole session when a rotated
// one comes back (a replay). These pin the frontend to one refresh at a time:
// many 401s together in a tab, two tabs on one kept session, and a refresh
// the network drops — none of them may end on /login.

/** From now on, API calls carrying any access token seen so far answer 401,
 * as when the 15-minute token expires mid-page. Returns the refresh count. */
async function expireTokens(ctx: BrowserContext) {
  const seen = new Set<string>();
  const stale = new Set<string>();
  let refreshes = 0;
  let expired = false;
  await ctx.route(`${API_URL}/**`, async (route) => {
    const req = route.request();
    if (req.url().endsWith("/auth/refresh")) {
      refreshes++;
      return route.continue();
    }
    const auth = req.headers()["authorization"];
    if (auth && !expired) seen.add(auth);
    if (auth && expired && stale.has(auth)) {
      return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Invalid or expired token" }) });
    }
    return route.continue();
  });
  return {
    expire() {
      expired = true;
      for (const a of seen) stale.add(a);
    },
    get refreshes() {
      return refreshes;
    },
  };
}

async function goToRules(page: Page) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Rules/ }).click();
  await expect(page).toHaveURL(/\/rules$/);
  await expect(page.getByRole("heading", { level: 1, name: "Rules" })).toBeVisible();
}

test("many 401s at once share one refresh, and the session survives", async ({ page }) => {
  const api = await expireTokens(page.context());
  // Loaded so the route sees the page's access token (sign-in lands on /home's pick).
  await page.goto("/devices");
  await expect(page.getByRole("table", { name: "Devices" })).toBeVisible();
  const before = api.refreshes;
  api.expire();

  // The Rules page fires several requests together; each gets a 401.
  await goToRules(page);
  // The heading renders before its data; wait for the refresh, then make
  // sure no second one follows.
  await expect.poll(() => api.refreshes - before).toBe(1);
  await page.waitForTimeout(1500);
  expect(api.refreshes - before).toBe(1);

  // The rotated session is still good (no replay revoked it).
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Rules" })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
});

test("two tabs on one kept session refresh in turn, without revoking it", async ({ browser }) => {
  const ctx = await browser.newContext();
  const [a, b] = [await ctx.newPage(), await ctx.newPage()];
  try {
    await a.goto("/login");
    await a.getByLabel("Email").fill(process.env.E2E_EMAIL!);
    await a.getByLabel("Password", { exact: true }).fill(process.env.E2E_PASSWORD!);
    await a.getByLabel("Keep me signed in on this device").check();
    await a.getByRole("button", { name: "Sign in", exact: true }).click();
    await landed(a);
    await a.goto("/devices");
    await b.goto("/devices");
    await expect(b.getByRole("table", { name: "Devices" })).toBeVisible();

    const api = await expireTokens(ctx);
    // Each tab makes one request with its token, so both are known.
    await a.reload();
    await b.reload();
    await expect(a.getByRole("table", { name: "Devices" })).toBeVisible();
    await expect(b.getByRole("table", { name: "Devices" })).toBeVisible();
    api.expire();

    await Promise.all([goToRules(a), goToRules(b)]);
    await a.reload();
    await expect(a.getByRole("heading", { level: 1, name: "Rules" })).toBeVisible();
    await expect(a).not.toHaveURL(/\/login/);
  } finally {
    await ctx.close();
  }
});

test("a refresh the network drops is retried, not a sign-out", async ({ page }) => {
  const api = await expireTokens(page.context());
  await page.goto("/devices");
  await expect(page.getByRole("table", { name: "Devices" })).toBeVisible();
  // The first two refresh attempts never reach the API.
  let dropped = 0;
  await page.route(`${API_URL}/auth/refresh`, (route) => (dropped++ < 2 ? route.abort("connectionrefused") : route.fallback()));
  api.expire();

  await goToRules(page);
  // Two drops (retried after 0.5 s and 1.5 s), then the third gets through.
  await expect.poll(() => dropped, { timeout: 10_000 }).toBe(3);
  await expect(page).not.toHaveURL(/\/login/);
});
