import { test as base, expect, type APIRequestContext } from "@playwright/test";

const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";

// Never published by any real device, so device_metric_health has no row for
// it — compute_rule_health (backend/src/app/rules/service.py) deterministically
// reports signal_state "missing" regardless of what telemetry is currently
// flowing for the device, keeping the health/simulate assertions below
// independent of live telemetry timing.
const FIXTURE_METRIC = "e2e-fixture-probe";

export type RuleFixture = {
  id: string;
  name: string;
  deviceId: string;
  deviceName: string;
  metric: string;
};

function credentials() {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "E2E_EMAIL / E2E_PASSWORD are not set. Copy frontend/.env.test.example to " +
        "frontend/.env.test and fill in a dev account's credentials.",
    );
  }
  return { email, password };
}

async function login(request: APIRequestContext) {
  const { email, password } = credentials();
  const res = await request.post(`${API_URL}/auth/login`, { data: { email, password } });
  if (!res.ok()) {
    throw new Error(`POST /auth/login failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  const tenantId: string | undefined = body.memberships?.[0]?.tenant_id;
  if (!tenantId) {
    throw new Error("Login succeeded but the account has no tenant membership.");
  }
  return { accessToken: body.access_token as string, tenantId };
}

export const test = base.extend<{ ruleUnderTest: RuleFixture }>({
  // Overrides the built-in `page` fixture: every test gets its own page,
  // already logged in via a fresh `POST /auth/login` (never a shared/reused
  // refresh token — see playwright.config.ts's note on why storageState
  // doesn't work against this backend's rotate-on-use refresh tokens).
  page: async ({ page }, use) => {
    const { email, password } = credentials();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL("/devices");
    await use(page);
  },

  ruleUnderTest: async ({ request }, use) => {
    const { accessToken, tenantId } = await login(request);
    const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };

    const devicesRes = await request.get(`${API_URL}/devices`, { headers });
    expect(devicesRes.ok(), `GET /devices failed: ${devicesRes.status()}`).toBeTruthy();
    const devices = await devicesRes.json();
    if (!Array.isArray(devices) || devices.length === 0) {
      throw new Error(
        "No devices exist for this tenant — the E2E rule fixture needs at least one " +
          "registered device to build a condition on.",
      );
    }
    const device = devices[0] as { id: string; name: string };

    const ruleName = `E2E fixture rule ${Date.now()}`;
    const createRes = await request.post(`${API_URL}/rules`, {
      headers,
      data: {
        name: ruleName,
        condition: {
          kind: "leaf",
          device_id: device.id,
          metric: FIXTURE_METRIC,
          operator: "==",
          threshold: 1,
        },
        actions: [
          { type: "notification", message: "E2E fixture firing", channels: ["platform"] },
        ],
        enabled: true,
      },
    });
    expect(
      createRes.ok(),
      `POST /rules failed: ${createRes.status()} ${await createRes.text()}`,
    ).toBeTruthy();
    const rule = await createRes.json();

    await use({
      id: rule.id,
      name: ruleName,
      deviceId: device.id,
      deviceName: device.name,
      metric: FIXTURE_METRIC,
    });

    const deleteRes = await request.delete(`${API_URL}/rules/${rule.id}`, { headers });
    expect(
      deleteRes.ok(),
      `DELETE /rules/${rule.id} cleanup failed: ${deleteRes.status()}`,
    ).toBeTruthy();
  },
});

export { expect } from "@playwright/test";
