import { expect } from "@playwright/test";
import { API_URL, login, test } from "./fixtures";

// DESIGN.md §9.10: the ladder is horizontal when it fits and vertical when it
// doesn't (never sideways), opens the same sheets as the Form, sends the
// trigger and timers to their tabs, draws the clear rung, and moves with the
// arrow keys.

test("ladder: horizontal when it fits, vertical on a phone, and nothing scrolls sideways", async ({ page, ruleUnderTest }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/rules/${ruleUnderTest.id}`);
  await page.getByRole("radiogroup", { name: "Editor view" }).getByRole("radio", { name: "Ladder" }).click();
  const rung = page.getByRole("group", { name: "Rule rung editor" });
  await expect(rung).toBeVisible();
  expect(await rung.evaluate((el) => el.tagName.toLowerCase())).toBe("svg");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rung).toBeVisible();
  expect(await rung.evaluate((el) => el.tagName.toLowerCase())).toBe("div");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("ladder: in the editor a wide rung scales down to fit before it goes vertical", async ({ page, request }) => {
  const { accessToken, tenantId } = await login(request);
  const headers = { Authorization: `Bearer ${accessToken}`, "X-Tenant-Id": tenantId };
  const devices = (await (await request.get(`${API_URL}/devices`, { headers })).json()) as { id: string }[];
  const leaf = (metric: string) => ({ kind: "leaf", device_id: devices[0].id, metric, operator: ">", rhs: { source: "static", value: 0 } });
  // a OR b OR (c AND d AND (e OR f)): three contacts in series, wider than the editor at 940 px.
  const rule = (await (
    await request.post(`${API_URL}/rules`, {
      headers,
      data: {
        name: `E2E wide rung ${Date.now()}`,
        enabled: false,
        condition: {
          kind: "group",
          op: "OR",
          predicates: [leaf("a"), leaf("b"), { kind: "group", op: "AND", predicates: [leaf("c"), leaf("d"), { kind: "group", op: "OR", predicates: [leaf("e"), leaf("f")] }] }],
        },
        actions: [{ type: "notification", message: "E2E wide rung", channels: ["platform"] }],
      },
    })
  ).json()) as { id: string };
  try {
    await page.setViewportSize({ width: 940, height: 900 });
    await page.goto(`/rules/${rule.id}?tab=if`);
    await page.getByRole("radiogroup", { name: "Editor view" }).getByRole("radio", { name: "Ladder" }).click();
    const rung = page.getByRole("group", { name: "Rule rung editor" });
    await expect(rung).toBeVisible();
    expect(await rung.evaluate((el) => el.tagName.toLowerCase())).toBe("svg");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await request.delete(`${API_URL}/rules/${rule.id}`, { headers });
  }
});

test("ladder: arrow keys move along the rung, Enter opens a sheet, the trigger opens When", async ({ page, ruleUnderTest }) => {
  await page.goto(`/rules/${ruleUnderTest.id}`);
  await page.getByRole("radiogroup", { name: "Editor view" }).getByRole("radio", { name: "Ladder" }).click();
  const rung = page.getByRole("group", { name: "Rule rung editor" });

  const trigger = rung.getByRole("button", { name: /^Trigger:/ });
  await trigger.focus();
  await page.keyboard.press("ArrowRight");
  const condition = rung.getByRole("button", { name: /^Condition / }).first();
  await expect(condition).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Condition" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();

  // The trigger has no sheet of its own: it opens the When tab.
  await trigger.click();
  const tabs = page.getByRole("tablist", { name: "Rule sections" });
  await expect(tabs.getByRole("tab", { name: /^When/ })).toHaveAttribute("aria-selected", "true");
});

test("ladder: a clear notification draws the CLEAR rung", async ({ page, ruleUnderTest }) => {
  await page.goto(`/rules/${ruleUnderTest.id}`);
  const tabs = page.getByRole("tablist", { name: "Rule sections" });
  await tabs.getByRole("tab", { name: /^Behaviour/ }).click();
  await page.getByRole("switch", { name: "Notify when it clears" }).click();
  await tabs.getByRole("tab", { name: /^If/ }).click();
  await page.getByRole("radiogroup", { name: "Editor view" }).getByRole("radio", { name: "Ladder" }).click();
  await expect(page.getByRole("group", { name: "Rule rung editor" }).getByRole("button", { name: /^On clear Notify/ })).toBeVisible();
  // Not saved: leave the fixture as it was.
  await page.getByRole("button", { name: "Discard" }).click();
});
