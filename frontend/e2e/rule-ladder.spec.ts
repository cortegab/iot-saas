import type { Page } from "@playwright/test";
import { API_URL, expect, login, test } from "./fixtures";

/** Fill the selected contact's device + metric (+ threshold) in the ladder
 * inspector. Works whether the device's catalog lists metrics (a select) or
 * not (a free-text input). */
async function fillContact(page: Page, deviceId: string, threshold: string) {
  // exact: the rung's contacts carry aria-labels that start with "Condition".
  const device = page.getByLabel("Condition device", { exact: true });
  if ((await device.inputValue()) !== deviceId) await device.selectOption(deviceId);
  const metric = page.getByLabel("Condition metric", { exact: true });
  const tag = await metric.evaluate((el) => el.tagName);
  if (tag === "SELECT") await metric.selectOption({ index: 1 });
  else await metric.fill("e2e-ladder-probe");
  const value = page.getByLabel("Threshold", { exact: true });
  if (await value.count()) await value.fill(threshold);
}

test("builds A AND (B OR C) AND D in the ladder, round-trips through the form, and saves", async ({
  page,
  request,
  ruleUnderTest,
}) => {
  const deviceId = ruleUnderTest.deviceId;
  const name = `E2E ladder rule ${Date.now()}`;
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };

  await page.goto("/rules/new");
  await page.getByRole("button", { name: /Start blank/ }).click();
  await page.getByRole("radiogroup", { name: "Editor view" }).getByRole("radio", { name: "Ladder" }).click();
  await page.getByLabel("Rule name").fill(name);

  // A — the starting contact.
  await page.getByRole("button", { name: /^Condition / }).first().click();
  await fillContact(page, deviceId, "10");
  // B — in series after A.
  await page.getByRole("button", { name: "Add in series" }).click();
  await fillContact(page, deviceId, "20");
  // C — in parallel below B.
  await page.getByRole("button", { name: "Add in parallel" }).click();
  await fillContact(page, deviceId, "30");
  // D — in series after the whole B/C parallel block, picked via the breadcrumb.
  await page.getByRole("navigation", { name: "Where this sits" }).getByRole("button", { name: "Parallel" }).click();
  await page.getByRole("button", { name: "Add in series" }).click();
  await fillContact(page, deviceId, "40");
  await expect(page.getByRole("button", { name: /^Condition / })).toHaveCount(4);

  // THEN: replace the default (empty) actuator coil with a notification.
  await page.getByRole("button", { name: "Add an action" }).click();
  await page.getByRole("button", { name: "+ In-app notification" }).click();
  // Field puts its hint inside the <label>, so the accessible name continues past "Message".
  await page.getByLabel(/^Message/).fill("E2E ladder fired");
  await page.getByRole("button", { name: /^Action actuator/ }).click();
  await page.getByRole("button", { name: "Remove coil" }).click();
  await expect(page.getByRole("button", { name: /^Action / })).toHaveCount(1);

  // The same tree in the form: an AND root with a nested OR group.
  await page.getByRole("radiogroup", { name: "Editor view" }).getByRole("radio", { name: "Form" }).click();
  await expect(page.getByRole("radiogroup", { name: "Combine with" })).toHaveCount(2);
  await expect(page.getByText(/ and \(.+ or .+\) and /)).toBeVisible();

  await page.getByRole("button", { name: "Create rule" }).click();
  await expect(page).toHaveURL("/rules");

  const rules = (await (await request.get(`${API_URL}/rules`, { headers })).json()) as {
    id: string;
    name: string;
    condition: { kind: string; op?: string; predicates?: { kind: string; op?: string }[] };
  }[];
  const saved = rules.find((r) => r.name === name);
  try {
    expect(saved).toBeTruthy();
    expect(saved!.condition.op).toBe("AND");
    expect(saved!.condition.predicates!.map((p) => p.op ?? p.kind)).toEqual(["leaf", "OR", "leaf"]);

    // And it shows up as a segment in the ladder overview.
    await page.goto("/rules?view=ladder");
    await expect(page.getByRole("img", { name: `Ladder for ${name}` })).toBeVisible();
  } finally {
    if (saved) await request.delete(`${API_URL}/rules/${saved.id}`, { headers });
  }
});
