// Deletes what the e2e suite leaves in the dev workspace: every record whose
// name starts with "E2E " (the specs' naming convention) and the
// notifications they caused. Runs after every suite (playwright.config.ts
// globalTeardown) and by hand with `pnpm test:e2e:clean`.
//
// Dev only: it talks to E2E_API_URL (default localhost) as the .env.test
// account, and touches nothing that isn't named like a test record.
import fs from "node:fs";

const API = process.env.E2E_API_URL ?? "http://localhost:8000";
const IS_TEST = (name) => typeof name === "string" && name.startsWith("E2E ");
const IS_TEST_NOTE = (message) => typeof message === "string" && (message.startsWith("E2E ") || message.startsWith("e2e-"));

function env() {
  if (process.env.E2E_EMAIL && process.env.E2E_PASSWORD) return { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD };
  const file = fs.existsSync(".env.test") ? fs.readFileSync(".env.test", "utf8") : "";
  const vars = Object.fromEntries(
    file
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
  return { email: vars.E2E_EMAIL, password: vars.E2E_PASSWORD };
}

export default async function cleanE2eData() {
  const { email, password } = env();
  if (!email || !password) return;
  const login = await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!login.ok) return;
  const body = await login.json();
  const headers = { Authorization: `Bearer ${body.access_token}`, "X-Tenant-Id": body.memberships[0].tenant_id };
  const list = async (path) => {
    const res = await fetch(`${API}${path}`, { headers });
    return res.ok ? res.json() : [];
  };
  const counts = {};
  // Rules first (they reference devices), then devices before their templates.
  // API keys can only be revoked (DELETE revokes; revoked keys are kept and
  // hidden by the list's default Active filter), so only active ones count.
  for (const [path, key] of [["/rules", "rules"], ["/dashboards", "dashboards"], ["/devices", "devices"], ["/catalog", "catalog"], ["/zones", "zones"], ["/api-keys", "api-keys revoked"]]) {
    const rows = (await list(path)).filter((r) => IS_TEST(r.name) && !(path === "/api-keys" && r.revoked_at));
    for (const r of rows) await fetch(`${API}${path}/${r.id}`, { method: "DELETE", headers });
    counts[key] = rows.length;
  }
  let dismissed = 0;
  for (let round = 0; round < 10; round++) {
    const notes = (await list("/notifications?limit=100")).filter((n) => IS_TEST_NOTE(n.message));
    if (notes.length === 0) break;
    for (const n of notes) await fetch(`${API}/notifications/${n.id}/dismiss`, { method: "POST", headers });
    dismissed += notes.length;
  }
  counts.notifications = dismissed;
  console.log("e2e cleanup:", Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", "));
}

if (import.meta.url === `file://${process.argv[1]}`) await cleanE2eData();
