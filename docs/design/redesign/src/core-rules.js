/* core-rules.js — the rule model the editor presents (mirrors lib/rule-draft.ts
   and docs/rule-engine-multi-device.md): WHEN trigger, an AND/OR condition tree,
   actions, behaviour. One validation pass, the sentence, schedule wording,
   preview (replay, would send, checks, conflicts) and the ladder drawing. */

const OPS = {
  ">": ["is above", 1], ">=": ["is at least", 1], "<": ["is below", 1], "<=": ["is at most", 1], "==": ["is", 1], "!=": ["is not", 1],
  between: ["is between", 2], outside: ["is outside", 2], in: ["is one of", 3], not_in: ["is not one of", 3],
  changed: ["changes", 0], increased: ["goes up", 0], decreased: ["goes down", 0],
};
const INEQ = [">", ">=", "<", "<="];
const devMetric = (devId, key) => { const d = devById(devId); return d ? metricOf(d, key) : null; };
const devActs = (devId) => (devById(devId) ? tplOf(devById(devId)).actuators : []);
const opsFor = (m) => (m?.type === "bool" ? ["==", "!=", "changed"] : Object.keys(OPS));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const unesc = (s) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/* ---------- Tree ---------- */
function walk(node, fn, parent = null) {
  if (!node) return;
  fn(node, parent);
  if (node.kind === "group") node.children.forEach((c) => walk(c, fn, node));
}
const leavesOf = (node) => { const out = []; walk(node, (n) => n.kind === "leaf" && out.push(n)); return out; };
function findNode(root, id) { let f = null, p = null; walk(root, (n, par) => { if (n.uid === id) { f = n; p = par; } }); return [f, p]; }
/** Collapse single-child groups and merge a child into a same-operator parent (rule-draft.ts normalize). */
function normalize(node) {
  if (!node || node.kind === "leaf") return node;
  node.children = node.children.map(normalize).filter(Boolean).flatMap((c) => (c.kind === "group" && c.op === node.op ? c.children : [c]));
  if (!node.children.length) return null;
  if (node.children.length === 1) return node.children[0];
  return node;
}
const hardware = (d) => d.actions.some((a) => a.type === "actuator");
const canClear = (d) => d.when.type === "metric" && d.behaviour === "rearm";
function newLeaf(d, devId) {
  const dev = devId || leavesOf(d.condition)[0]?.dev || (d.when.dev && tplOf(devById(d.when.dev))?.metrics.length ? d.when.dev : "d1");
  const m = tplOf(devById(dev))?.metrics[0];
  return { uid: uid("l"), kind: "leaf", dev, metric: m?.key || "", op: m?.type === "bool" ? "==" : ">", value: m?.type === "bool" ? true : null, low: null, high: null, set: "", rhs: "static", rhsDev: "", rhsMetric: "", hyst: m?.type === "bool" ? 0 : 1 };
}
const newGroup = (op, children) => ({ uid: uid("g"), kind: "group", op, children });

/* ---------- Validation: one pass; blocking vs safety warnings ---------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function ruleIssues(d) {
  const I = [];
  const add = (sec, path, level, text) => I.push({ sec, path, level, text });
  const w = d.when;
  if (w.type === "schedule" && !cronValid(w.cron)) add("when", "when.cron", "block", "The schedule isn't valid: five fields, minute hour day month weekday.");
  if (w.type === "device_status" && !w.dev) add("when", "when.dev", "block", "Pick the device.");
  if (w.type === "metric" && !d.condition) add("if", "condition", "block", "Add at least one condition.");
  for (const l of leavesOf(d.condition)) {
    const p = `leaf#${l.uid}`;
    const m = devMetric(l.dev, l.metric);
    const ar = OPS[l.op]?.[1];
    if (!l.dev) add("if", p + ".dev", "block", "Pick a device.");
    else if (!m) add("if", p + ".metric", "block", "Pick a reading.");
    else if (ar === 1 && l.rhs === "metric") { if (!devMetric(l.rhsDev, l.rhsMetric)) add("if", p + ".rhsMetric", "block", "Pick the reading to compare with."); }
    else if (ar === 1 && (l.value === null || l.value === "")) add("if", p + ".value", "block", "Enter a value.");
    else if (ar === 2) { if (l.low == null || l.high == null) add("if", p + ".high", "block", "Enter both ends of the range."); else if (l.low > l.high) add("if", p + ".high", "block", "The second value must be the larger one."); }
    else if (ar === 3 && !String(l.set || "").split(",").some((s) => s.trim())) add("if", p + ".set", "block", "List at least one value.");
    if (m && m.type !== "bool" && INEQ.includes(l.op) && !(l.hyst > 0) && hardware(d) && w.type === "metric") add("if", p + ".hyst", "warn", "No hysteresis: a noisy reading can switch the hardware back and forth.");
  }
  if (!d.actions.length) add("then", "actions", "block", "Add at least one action.");
  for (const a of d.actions) {
    const p = `actions#${a.uid}`;
    if (a.type === "actuator") { if (!a.dev) add("then", p + ".dev", "block", "Pick a device."); else if (!devActs(a.dev).some((x) => x.key === a.act)) add("then", p + ".act", "block", "Pick what it switches."); }
    if (a.type === "email") {
      if (String(a.to || "").split(",").map((s) => s.trim()).filter(Boolean).some((t) => !EMAIL_RE.test(t))) add("then", p + ".to", "block", "Check the addresses.");
      if (!String(a.subject || "").trim()) add("then", p + ".subject", "block", "Add a subject.");
      if (!String(a.body || "").trim()) add("then", p + ".body", "block", "Write the message.");
    }
    if (a.type === "webhook") {
      if (!/^https?:\/\/\S+$/.test(a.url || "")) add("then", p + ".url", "block", "Enter an http or https address.");
      try { if (a.body) JSON.parse(a.body); } catch { add("then", p + ".body", "block", "The body isn't valid JSON."); }
    }
    if (a.type === "notification" && !String(a.message || "").trim()) add("then", p + ".message", "block", "Write the message.");
  }
  if (w.type === "metric" && (d.hold ?? 0) < 5) add("behaviour", "hold", "warn", "Under 5 s, a single noisy reading can fire it.");
  if ((d.cooldown ?? 0) < 30) add("behaviour", "cooldown", "warn", "Under 30 s, it can fire again almost at once.");
  if (d.clearNotify && canClear(d) && !String(d.clearMessage || "").trim()) add("behaviour", "clearMessage", "block", "Write the message, or turn this off.");
  if (canClear(d) && d.actions.some((a) => a.type === "actuator" && a.revert) && !(d.clearDelay > 0) && leavesOf(d.condition).some((l) => INEQ.includes(l.op) && !(l.hyst > 0)))
    add("behaviour", "clearDelay", "warn", "It switches back with no clear delay and no hysteresis, so it may flap.");
  if ((d.name || "").length > 200) add("name", "name", "block", "Keep it under 200 characters.");
  return I;
}
const ruleValidate = (d) => { const E = {}, W = {}; for (const i of ruleIssues(d)) (i.level === "block" ? E : W)[i.path] ||= i.text; return { E, W }; };
/** A section's badge: red count of visible blocking problems, else an amber "!" for warnings. */
function secBadge(d, sec, { showAll = false } = {}) {
  const I = ruleIssues(d).filter((i) => i.sec === sec);
  const blocks = I.filter((i) => i.level === "block" && (showAll || shown(i.path))).length;
  if (blocks) return `<span class="sb sb--err">${blocks}<span class="sr-only"> to fix</span></span>`;
  if (I.some((i) => i.level === "warn")) return `<span class="sb sb--warn" aria-label="safety warning">!</span>`;
  return "";
}
const issueAt = (prefix, level) => ruleIssues(ED.draft).filter((i) => i.path.startsWith(prefix) && i.level === level && (level === "warn" || shown(i.path)));

/* ---------- Schedule: cron stays the stored format (DESIGN §9.5) ---------- */
const pad2 = (n) => String(n).padStart(2, "0");
const DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const cronFields = (c) => { const f = String(c || "").trim().split(/\s+/); return f.length === 5 ? f : null; };
const CRON_RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const PART = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/;
function fieldOk(s, min, max) {
  return s.split(",").every((part) => {
    const m = part.match(PART);
    if (!m) return false;
    if (m[1] !== "*") { const [a, b] = m[1].split("-").map(Number); if (a < min || a > max || (b != null && (b < a || b > max))) return false; }
    return !m[2] || +m[2] >= 1;
  });
}
const cronValid = (c) => { const f = cronFields(c); return !!f && f.every((x, i) => fieldOk(x, ...CRON_RANGES[i])); };
function fieldMatch(s, v, min) {
  return s.split(",").some((part) => {
    const m = part.match(PART);
    if (!m) return false;
    let lo = min, hi = 99;
    if (m[1] !== "*") { const [a, b] = m[1].split("-").map(Number); lo = a; hi = b ?? (m[2] ? 99 : a); }
    return v >= lo && v <= hi && (v - lo) % +(m[2] || 1) === 0;
  });
}
function nextRuns(c, n = 3) {
  const f = cronFields(c);
  if (!f || !cronValid(c)) return [];
  const out = [];
  const t = new Date();
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 35 && out.length < n; i++) {
    const dow = t.getDay();
    if (fieldMatch(f[0], t.getMinutes(), 0) && fieldMatch(f[1], t.getHours(), 0) && fieldMatch(f[2], t.getDate(), 1) && fieldMatch(f[3], t.getMonth() + 1, 1) && (fieldMatch(f[4], dow, 0) || (dow === 0 && fieldMatch(f[4], 7, 0)))) out.push(new Date(t));
    t.setMinutes(t.getMinutes() + 1);
  }
  return out;
}
function expandDow(s) { const out = new Set(); for (const p of s.split(",")) { const [a, b] = p.split("-").map(Number); for (let i = a; i <= (b ?? a); i++) out.add(i % 7); } return [...out].sort(); }
function parseSchedule(cron) {
  const base = { mode: "custom", h: 8, m: 0, days: [1, 2, 3, 4, 5], every: 15, unit: "min", dom: 1 };
  const f = cronFields(cron);
  if (!f) return base;
  const [mi, hr, dom, mon, dow] = f;
  const num = (s) => /^\d+$/.test(s);
  if (num(mi) && num(hr) && dom === "*" && mon === "*" && dow === "*") return { ...base, mode: "daily", h: +hr, m: +mi };
  if (num(mi) && num(hr) && dom === "*" && mon === "*" && /^[\d,-]+$/.test(dow)) return { ...base, mode: "days", h: +hr, m: +mi, days: expandDow(dow) };
  if (/^\*\/\d+$/.test(mi) && hr === "*" && dom === "*" && mon === "*" && dow === "*") return { ...base, mode: "repeat", every: +mi.slice(2), unit: "min" };
  if (mi === "0" && /^\*\/\d+$/.test(hr) && dom === "*" && mon === "*" && dow === "*") return { ...base, mode: "repeat", every: +hr.slice(2), unit: "hour" };
  if (num(mi) && num(hr) && num(dom) && +dom <= 28 && mon === "*" && dow === "*") return { ...base, mode: "monthly", h: +hr, m: +mi, dom: +dom };
  return base;
}
function buildCron(s) {
  if (s.mode === "daily") return `${s.m} ${s.h} * * *`;
  if (s.mode === "days") { const d = [...s.days].sort(); return `${s.m} ${s.h} * * ${d.join(",") === "1,2,3,4,5" ? "1-5" : d.join(",") || "1"}`; }
  if (s.mode === "repeat") return s.unit === "min" ? `*/${s.every} * * * *` : `0 */${s.every} * * *`;
  if (s.mode === "monthly") return `${s.m} ${s.h} ${s.dom} * *`;
  return null;
}
const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
function cronText(c) {
  const s = parseSchedule(c);
  const t = `${pad2(s.h)}:${pad2(s.m)}`;
  if (s.mode === "daily") return `every day at ${t}`;
  if (s.mode === "days") { const d = s.days.join(","); return d === "1,2,3,4,5" ? `weekdays at ${t}` : d === "0,6" ? `weekends at ${t}` : `${s.days.map((i) => DOWS[i]).join(", ")} at ${t}`; }
  if (s.mode === "repeat") return `every ${s.every} ${s.unit === "min" ? "min" : "h"}`;
  if (s.mode === "monthly") return `on the ${ordinal(s.dom)} of each month at ${t}`;
  return cronValid(c) ? `on the schedule ${c}` : "on a schedule that isn't valid yet";
}
/* Time zone select (DESIGN §9.6): "City (GMT±h)", grouped, sorted by offset. */
const TZS = ["America/Los_Angeles", "America/Denver", "America/Mexico_City", "America/Bogota", "America/New_York", "America/Sao_Paulo", "Europe/London", "Europe/Madrid", "Europe/Oslo", "Africa/Lagos", "Asia/Dubai", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney", "UTC"];
function tzOffset(z) { try { const p = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((x) => x.type === "timeZoneName").value; return p === "GMT" ? "GMT+0" : p; } catch { return "GMT"; } }
const tzCity = (z) => (z === "UTC" ? "UTC" : z.split("/").pop().replace(/_/g, " "));
const TZ_GROUPS = ["Americas", "Europe & Africa", "Asia & Pacific", "Other"];
const tzGroup = (z) => (z === "UTC" ? "Other" : z.startsWith("America") ? "Americas" : /^(Europe|Africa)/.test(z) ? "Europe & Africa" : "Asia & Pacific");
const offNum = (o) => { const m = o.match(/GMT([+-]\d+)(?::(\d+))?/); return m ? +m[1] + (m[2] ? Math.sign(+m[1]) * +m[2] / 60 : 0) : 0; };
const tzOptions = (cur) => [...new Set([...TZS, cur])].map((z) => ({ v: z, l: `${tzCity(z)} (${tzOffset(z)})`, g: tzGroup(z), o: offNum(tzOffset(z)) }))
  .sort((a, b) => TZ_GROUPS.indexOf(a.g) - TZ_GROUPS.indexOf(b.g) || a.o - b.o || a.l.localeCompare(b.l));
const triggerText = (w) => (w.type === "metric" ? "On each reading" : w.type === "schedule" ? cap(cronText(w.cron)) : w.type === "manual" ? "Manually" : `${devById(w.dev)?.name || "A device"} ${w.status === "disconnected" ? "disconnects" : "connects"}`);

/* ---------- Words: leaves, actions, the sentence ---------- */
function leafText(l) {
  const m = devMetric(l.dev, l.metric);
  const [word, ar] = OPS[l.op] || ["?", 1];
  const u = unitOf(m) ? " " + m.unit : "";
  let v = "";
  if (ar === 1) v = l.rhs === "metric" ? `${devMetric(l.rhsDev, l.rhsMetric)?.name || "…"} on ${devById(l.rhsDev)?.name || "…"}` : m?.type === "bool" ? (l.value ? "On" : "Off") : l.value == null || l.value === "" ? "…" : l.value + u;
  if (ar === 2) v = `${l.low ?? "…"} and ${l.high ?? "…"}${u}`;
  if (ar === 3) v = l.set || "…";
  return `${m?.name || l.metric || "a reading"} on ${devById(l.dev)?.name || "a device"} ${word}${ar ? " " + v : ""}`;
}
function condHtml(node, chips, top = true) {
  if (!node) return chips ? '<span class="muted">…</span>' : "…";
  if (node.kind === "leaf") return chips ? `<button type="button" class="tok" data-act="chip-leaf" data-uid="${node.uid}">${esc(leafText(node))}</button>` : esc(leafText(node));
  const inner = node.children.map((c) => condHtml(c, chips, false)).join(` <span class="kw">${node.op === "all" ? "and" : "or"}</span> `);
  return top ? inner : `(${inner})`;
}
const actName = (a) => devActs(a.dev).find((x) => x.key === a.act)?.name || a.act || "an actuator";
const clearValueOf = (a) => (a.clearValue == null ? (typeof a.value === "boolean" ? !a.value : "back") : a.clearValue);
function actionText(a, clear = false) {
  if (a.type === "actuator") return `turn ${actName(a)}${clear ? " back" : ""} ${unesc(fmtVal(clear ? clearValueOf(a) : a.value))}`;
  if (a.type === "email") return `email ${a.to || "the alert recipients"}`;
  if (a.type === "webhook") return `call ${(a.url || "a webhook").replace(/^https?:\/\//, "").split("/")[0]}`;
  return "post a notification";
}
function ruleSentenceHtml(d, chips = true) {
  const w = d.when;
  const chip = (act, txt, attrs = "") => (chips ? `<button type="button" class="tok" data-act="${act}" ${attrs}>${esc(txt)}</button>` : esc(txt));
  let s;
  if (w.type === "metric") s = `<span class="kw">When</span> ${condHtml(d.condition, chips)}`;
  else if (w.type === "schedule") s = `${chip("chip-goto", cap(cronText(w.cron)), 'data-sec="when"')}${d.condition ? `, <span class="kw">if</span> ${condHtml(d.condition, chips)}` : ""}`;
  else if (w.type === "manual") s = `<span class="kw">When run by hand</span>${d.condition ? `, <span class="kw">if</span> ${condHtml(d.condition, chips)}` : ""}`;
  else s = `<span class="kw">When</span> ${chip("chip-goto", `${devById(w.dev)?.name || "a device"} ${w.status === "disconnected" ? "disconnects" : "connects"}`, 'data-sec="when"')}`;
  if (w.type === "metric" && d.hold > 0) s += ` for ${chip("chip-hold", `${d.hold} s`)}`;
  s += `, <span class="kw">then</span> ${d.actions.length ? d.actions.map((a) => chip(a.type === "actuator" && typeof a.value === "boolean" ? "chip-act" : "chip-goto", actionText(a), `data-sec="then" data-uid="${a.uid}"`)).join(" and ") : '<span class="muted">…</span>'}`;
  const reverts = canClear(d) ? d.actions.filter((a) => a.type === "actuator" && a.revert) : [];
  if (reverts.length || (canClear(d) && d.clearNotify)) s += `. <span class="kw">When it clears</span>${d.clearDelay ? ` for ${d.clearDelay} s` : ""}, ${[...reverts.map((a) => esc(actionText(a, true))), ...(d.clearNotify ? ["post a notification"] : [])].join(" and ")}`;
  if (d.behaviour === "latch") s += `. It <span class="kw">latches</span> until reset`;
  return s + ".";
}
const rulePlain = (d) => unesc(ruleSentenceHtml(d, false));
const ruleSentence = (r, plain = false) => (plain ? rulePlain(r.draft) : ruleSentenceHtml(r.draft, false));

/* ---------- Derived fields for the rest of the app ---------- */
function ruleRefs(r) {
  const d = r.draft;
  return { metrics: leavesOf(d.condition).flatMap((l) => [[l.dev, l.metric], ...(l.rhs === "metric" ? [[l.rhsDev, l.rhsMetric]] : [])]), actuators: d.actions.filter((a) => a.type === "actuator").map((a) => [a.dev, a.act]), devices: [...new Set([...leavesOf(d.condition).map((l) => l.dev), ...d.actions.map((a) => a.dev).filter(Boolean), d.when.type === "device_status" ? d.when.dev : null].filter(Boolean))] };
}
const ruleUses = (r, ids) => ruleRefs(r).devices.some((x) => ids.includes(x));
/** The threshold a chart draws for a device's metric, from the first enabled rule that compares it. */
function thresholdFor(devId, key) {
  for (const r of RULES) { if (!r.draft.enabled) continue; const l = leavesOf(r.draft.condition).find((x) => x.dev === devId && x.metric === key && INEQ.includes(x.op) && typeof x.value === "number" && x.rhs === "static"); if (l) return l.value; }
  return undefined;
}
function ruleShares(r) {
  const mine = ruleRefs(r).actuators.map((x) => x.join(":"));
  for (const o of RULES) if (o !== r && o.draft.enabled) { const hit = ruleRefs(o).actuators.find((x) => mine.includes(x.join(":"))); if (hit) return devActs(hit[0]).find((a) => a.key === hit[1])?.key || hit[1]; }
  return "";
}
function syncRule(r) {
  const d = r.draft;
  r.name = d.name;
  r.enabled = d.enabled;
  if (!d.enabled) r.state = "disabled";
  else if (r.state === "disabled") r.state = "armed";
  const l = leavesOf(d.condition)[0];
  r.device = l?.dev || d.when.dev || d.actions.find((a) => a.dev)?.dev || null;
  r.metric = l?.metric;
  const a = d.actions[0];
  r.action = a?.type === "actuator" ? { type: "command", device: a.dev, actuator: a.act, value: a.value } : { type: a?.type || "none", to: a?.to };
  r.trigger = triggerText(d.when);
  // The list strip, "fired N×" and Activity come from the same replay the preview shows.
  if (d.when.type === "metric" && d.enabled) {
    const rp = replay(d);
    if (rp.cells && /[tf.]/.test(rp.cells)) { r.strip = rp.cells; r.fired24 = (rp.cells.match(/f/g) || []).length; }
  }
  r.versions ||= [
    { v: 3, by: "Cesar Ortega", at: NOW - 2 * DAY, lines: ["Hold time: 5 s → " + d.hold + " s"], draft: { ...clone(d), hold: 5 } },
    { v: 2, by: "Lucía Méndez", at: NOW - 9 * DAY, lines: ["Minimum interval: 30 s → " + d.cooldown + " s"], draft: { ...clone(d), hold: 5, cooldown: 30 } },
    { v: 1, by: "Cesar Ortega", at: NOW - 20 * DAY, lines: ["Created"], draft: { ...clone(d), hold: 5, cooldown: 30 } },
  ];
}
RULES.forEach(syncRule);
function ruleDiff(a, b) {
  const L = [];
  const ch = (label, x, y) => { if (x !== y) L.push(`${label}: ${x} → ${y}`); };
  ch("Name", a.name || "—", b.name || "—");
  if (a.enabled !== b.enabled) L.push(`Status: ${b.enabled ? "Enabled" : "Disabled"}`);
  ch("Trigger", triggerText(a.when), triggerText(b.when));
  if (b.when.type === "schedule") ch("Time zone", tzCity(a.when.tz), tzCity(b.when.tz));
  if (rulePlain({ ...a, actions: [], hold: 0, behaviour: "rearm" }) !== rulePlain({ ...b, actions: [], hold: 0, behaviour: "rearm" })) L.push(`Conditions: ${condHtml(b.condition, false)}`);
  if (JSON.stringify(a.actions) !== JSON.stringify(b.actions)) L.push(`Actions: ${b.actions.map((x) => actionText(x)).join(", ") || "none"}`);
  ch("Behaviour", a.behaviour === "latch" ? "Latch" : "Re-arm", b.behaviour === "latch" ? "Latch" : "Re-arm");
  ch("Hold time", `${a.hold} s`, `${b.hold} s`);
  ch("Minimum interval", `${a.cooldown} s`, `${b.cooldown} s`);
  ch("Clear delay", `${a.clearDelay} s`, `${b.clearDelay} s`);
  if (a.clearNotify !== b.clearNotify || a.clearMessage !== b.clearMessage) L.push("Clear notification changed");
  return L;
}

/* ---------- Preview: replay, would send, checks, conflicts, dry run ---------- */
function evalLeafAt(l, t) {
  const m = devMetric(l.dev, l.metric);
  const dv = devById(l.dev);
  if (!m || !dv || dv.status === "never" || (dv.status !== "online" && dv.seen && t > dv.seen)) return null;
  const x = m.type === "bool" ? (sample(l.dev, l.metric, t) ? 1 : 0) : sample(l.dev, l.metric, t);
  const rhs = l.rhs === "metric" ? sample(l.rhsDev, l.rhsMetric, t) : m.type === "bool" ? (l.value ? 1 : 0) : Number(l.value);
  const set = String(l.set || "").split(",").map((s) => Number(s.trim()));
  const prev = sample(l.dev, l.metric, t - 15 * MIN);
  switch (l.op) {
    case ">": return x > rhs; case ">=": return x >= rhs; case "<": return x < rhs; case "<=": return x <= rhs;
    case "==": return x === rhs; case "!=": return x !== rhs;
    case "between": return x >= l.low && x <= l.high; case "outside": return x < l.low || x > l.high;
    case "in": return set.includes(x); case "not_in": return !set.includes(x);
    case "increased": return x > prev + 0.3; case "decreased": return x < prev - 0.3; default: return Math.abs(x - prev) > 0.3;
  }
}
/** Three-valued: stale or missing data is unknown, never false. */
function evalNode(n, t) {
  if (!n) return true;
  if (n.kind === "leaf") return evalLeafAt(n, t);
  const v = n.children.map((c) => evalNode(c, t));
  if (n.op === "all") return v.includes(false) ? false : v.includes(null) ? null : true;
  return v.includes(true) ? true : v.includes(null) ? null : false;
}
function replay(d) {
  const w = d.when;
  if (w.type !== "metric") return { cells: "", text: w.type === "schedule" ? `Fires on its schedule: ${cronText(w.cron)}.` : w.type === "manual" ? "Fires only when someone presses Run now." : `Fires when ${devById(w.dev)?.name || "the device"} ${w.status === "disconnected" ? "disconnects" : "connects"}.` };
  if (!d.condition) return { cells: "", text: "Add a condition to see the last 24 hours." };
  let cells = "", prev = false, latched = false, last = -Infinity;
  const fires = [];
  for (let i = 0; i < 48; i++) {
    const t = Date.now() - DAY + (i + 1) * 30 * MIN;
    const v = evalNode(d.condition, t);
    const fire = v === true && !prev && !latched && t - last >= (d.cooldown || 0) * 1000;
    if (fire) { fires.push(t); last = t; if (d.behaviour === "latch") latched = true; }
    cells += fire ? "f" : v === null ? "u" : v ? "t" : ".";
    prev = v === true;
  }
  const unknown = !cells.replace(/u/g, "").length;
  return { cells, noisy: fires.length > 12, text: unknown ? "Can't replay: its devices sent nothing in the last 24 hours." : fires.length ? `Would have fired ${fires.length}× at ${fires.slice(0, 4).map((t) => F_TIME.format(new Date(t))).join(", ")}${fires.length > 4 ? ", …" : ""}.` : "Would not have fired in the last 24 hours." };
}
function wouldSend(d) {
  const out = [];
  const slug = (id) => devById(id)?.slug || "{device}";
  for (const a of d.actions) {
    if (a.type === "actuator") {
      out.push({ t: cap(actionText(a)), code: `${topicOf("cmd/" + (a.act || "{actuator}"), slug(a.dev))}\n${JSON.stringify({ value: a.value, ttl: 30 })}` });
      if (a.revert && canClear(d)) out.push({ t: `When it clears: ${actionText(a, true)}`, code: `${topicOf("cmd/" + a.act, slug(a.dev))}\n${JSON.stringify({ value: clearValueOf(a), ttl: 30 })}` });
    } else if (a.type === "email") out.push({ t: "Email", code: `to:      ${a.to || WORKSPACE.recipients.join(", ")}\nsubject: ${a.subject || "…"}` });
    else if (a.type === "webhook") out.push({ t: "Webhook", code: `POST ${a.url || "…"}\n${a.body || "{}"}` });
    else out.push({ t: "Notification", code: a.message || "…" });
  }
  if (d.clearNotify && canClear(d)) out.push({ t: "When it clears: notification", code: d.clearMessage || "…" });
  return out;
}
function ruleChecks(d) {
  const I = ruleIssues(d);
  const has = (sec, level) => I.some((i) => i.sec === sec && i.level === level);
  const warnPath = (p) => I.some((i) => i.path.startsWith(p) && i.level === "warn") || I.some((i) => i.path.endsWith(p) && i.level === "warn");
  const out = [
    [has("when", "block") ? "block" : "ok", "Trigger is set"],
    [has("if", "block") ? "block" : "ok", d.when.type === "metric" ? "Conditions are complete" : "Conditions (optional) are complete"],
    [has("then", "block") ? "block" : "ok", "Actions are complete"],
  ];
  if (d.when.type === "metric") out.push([warnPath("hold") ? "warn" : "ok", "Hold time is at least 5 s"]);
  out.push([warnPath("cooldown") ? "warn" : "ok", "Minimum interval is at least 30 s"]);
  if (hardware(d) && d.when.type === "metric") out.push([I.some((i) => i.path.endsWith(".hyst")) ? "warn" : "ok", "Hysteresis on every comparison (it switches hardware)"]);
  return out;
}
function otherRulesOn(d, selfId) {
  const out = [];
  for (const a of d.actions.filter((x) => x.type === "actuator" && x.act)) {
    for (const o of RULES) {
      if (o.id === selfId || !o.draft.enabled) continue;
      const b = o.draft.actions.find((x) => x.type === "actuator" && x.dev === a.dev && x.act === a.act);
      if (b) out.push({ r: o, a, conflict: b.value !== a.value || (b.revert && canClear(o.draft)) !== (a.revert && canClear(d)) });
    }
  }
  return out;
}
function dryRun(d) {
  if (d.when.type !== "metric") return `It would ${d.actions.map((a) => actionText(a)).join(" and ") || "do nothing"} when triggered. Nothing was sent.`;
  const v = evalNode(d.condition, Date.now());
  const now = leavesOf(d.condition).map((l) => { const m = devMetric(l.dev, l.metric); const r = READINGS[l.dev]?.[l.metric]; return `${m?.name || l.metric} ${r && r[0] != null ? fmtReading(m, r[0]) + (unitOf(m) ? " " + m.unit : "") : "no data"}`; }).join(", ");
  return `${v === null ? "Can't decide now: some inputs have no fresh data" : v ? "The condition is true now" : "The condition is false now"} (${now}). ${v ? `It would ${d.actions.map((a) => actionText(a)).join(" and ")}${d.hold ? ` after ${d.hold} s` : ""}.` : "It would do nothing."} Nothing was sent.`;
}
function firingsFor(r) {
  const d = r.draft;
  const out = [];
  [...(r.strip || "")].forEach((c, i) => {
    if (c !== "f") return;
    const at = Date.now() - DAY + (i + 1) * 30 * MIN;
    out.push({ at, what: "Fired", outcomes: d.actions.map((a) => (a.type === "webhook" ? { label: `Webhook to ${(a.url || "").replace(/^https?:\/\//, "").split("/")[0]}`, ok: false, reason: "The server answered 404 Not Found. Retried 3 times; it's in Failed deliveries." } : { label: cap(actionText(a)), ok: true, reason: a.type === "actuator" ? "confirmed by the device" : "sent" })) });
    if (canClear(d) && d.actions.some((a) => a.revert)) out.push({ at: at + 40 * MIN, what: "Cleared", outcomes: d.actions.filter((a) => a.revert).map((a) => ({ label: cap(actionText(a, true)), ok: true, reason: "confirmed by the device" })) });
  });
  if (d.when.type === "device_status") out.push({ at: NOW - 2 * HOUR, what: "Fired", outcomes: d.actions.map((a) => (a.type === "webhook" ? { label: "Webhook to hooks.example.com", ok: false, reason: "The server answered 404 Not Found. Retried 3 times; it's in Failed deliveries." } : { label: cap(actionText(a)), ok: true, reason: "sent" })) });
  return out.sort((a, b) => b.at - a.at);
}
const stripHtml = (s, label = "Last 24 hours") => `<span class="strip" role="img" aria-label="${label}">${[...String(s || "").padEnd(48, ".")].map((c) => `<i class="${c === "t" ? "t" : c === "f" ? "f" : c === "u" ? "u" : ""}"></i>`).join("")}</span>`;

/* ---------- Ladder: horizontal while it fits, vertical below ---------- */
const LADDERS = {};
const ladderHtml = (id, get, opts = {}) => { LADDERS[id] = { get, ...opts }; return `<div class="ladder" data-ladder="${id}"></div>`; };
function drawLadders() {
  for (const el of $$("[data-ladder]")) {
    const L = LADDERS[el.dataset.ladder];
    const d = L?.get();
    if (!d) continue;
    const html = ladderMarkup(d, el.clientWidth || 640, L);
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
  }
}
const LW = 156, LH = 72;
function lay(n) {
  if (!n) return { w: 0, h: 1 };
  if (n.kind === "leaf") return { w: 1, h: 1 };
  const ls = n.children.map(lay);
  return n.op === "all" ? { w: ls.reduce((s, x) => s + x.w, 0), h: Math.max(...ls.map((x) => x.h)) } : { w: Math.max(...ls.map((x) => x.w)), h: ls.reduce((s, x) => s + x.h, 0) };
}
const coilGlyph = (d, a) => (d.behaviour === "latch" ? "S" : a.type === "email" ? "✉" : a.type === "webhook" ? "⇢" : a.type === "notification" ? "!" : a.revert && canClear(d) ? "" : "P");
const coilLabel = (a) => (a.type === "actuator" ? [actName(a), "→ " + unesc(fmtVal(a.value))] : a.type === "email" ? ["Email", a.to || "alert list"] : a.type === "webhook" ? ["Webhook", (a.url || "").replace(/^https?:\/\//, "").split("/")[0] || "…"] : ["Notify", "in-app"]);
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const leafShort = (l) => {
  const m = devMetric(l.dev, l.metric);
  const ar = OPS[l.op]?.[1];
  const sym = { ">": ">", ">=": "≥", "<": "<", "<=": "≤", "==": "=", "!=": "≠", between: "in", outside: "out", in: "∈", not_in: "∉", changed: "Δ", increased: "↑", decreased: "↓" }[l.op];
  const v = ar === 1 ? (l.rhs === "metric" ? devMetric(l.rhsDev, l.rhsMetric)?.name || "…" : m?.type === "bool" ? (l.value ? "On" : "Off") : l.value ?? "…") : ar === 2 ? `${l.low ?? "…"}–${l.high ?? "…"}` : ar === 3 ? l.set || "…" : "";
  return [`${m?.name || "?"} ${sym} ${v}${ar === 1 && l.rhs !== "metric" && unitOf(m) ? " " + m.unit : ""}`.trim(), devById(l.dev)?.name || "no device", m?.type === "bool" && (l.op === "!=" || l.value === false)];
};
function ladderMarkup(d, W, L) {
  const ro = !!L.readOnly;
  const cs = lay(d.condition);
  const evTrig = d.when.type !== "metric";
  const contactsW = (evTrig ? 1 : 0) + cs.w;
  const coils = d.actions;
  const holdW = d.when.type === "metric" && d.hold > 0 ? 104 : 0;
  const need = 28 + contactsW * LW + (ro ? 0 : 40) + holdW + 210;
  return need <= W ? ladderSvg(d, W, ro, cs, evTrig) : ladderVertical(d, ro);
}
const act = (ro, a, extra = "") => (ro ? "" : `data-act="${a}" ${extra} tabindex="0" role="button" data-lad="1"`);
function ladderSvg(d, W, ro, cs, evTrig) {
  const top = 34;
  const rows = Math.max(cs.h, d.actions.length + (ro ? 0 : 1), 1);
  // "+ OR" under the whole condition block needs a row of its own.
  const condBottom = top + cs.h * LH;
  const orBlock = !ro && !!d.condition;
  const rungBottom = Math.max(top + rows * LH, orBlock ? condBottom + 38 : 0);
  let svg = "";
  const x0 = 20;
  let x = x0 + 8;
  const mid = top + LH / 2;
  const trig = triggerText(d.when).toUpperCase();
  svg += `<text x="${x0 + 6}" y="18" class="lad-cap">${esc(clip(trig, 40))}${d.condition && d.condition.kind === "group" ? ` · ${d.condition.op === "all" ? "ALL" : "ANY"} OF` : ""}</text>`;
  const contact = (cx, cy, l) => {
    const [t1, t2, nc] = leafShort(l);
    const err = !ro && issueOnLeaf(l);
    return `<g class="lad-el ${err ? "lad-err" : ""}" ${act(ro, "lad-leaf", `data-uid="${l.uid}" aria-label="Condition: ${esc(leafText(l))}"`)}>
      <rect x="${cx}" y="${cy}" width="${LW}" height="${LH}" class="lad-hit"/>
      <line x1="${cx}" x2="${cx + LW / 2 - 10}" y1="${cy + LH / 2}" y2="${cy + LH / 2}" class="lad-wire"/><line x1="${cx + LW / 2 + 10}" x2="${cx + LW}" y1="${cy + LH / 2}" y2="${cy + LH / 2}" class="lad-wire"/>
      <line x1="${cx + LW / 2 - 10}" x2="${cx + LW / 2 - 10}" y1="${cy + LH / 2 - 11}" y2="${cy + LH / 2 + 11}" class="lad-sym"/><line x1="${cx + LW / 2 + 10}" x2="${cx + LW / 2 + 10}" y1="${cy + LH / 2 - 11}" y2="${cy + LH / 2 + 11}" class="lad-sym"/>
      ${nc ? `<line x1="${cx + LW / 2 - 8}" x2="${cx + LW / 2 + 8}" y1="${cy + LH / 2 + 9}" y2="${cy + LH / 2 - 9}" class="lad-sym"/>` : ""}
      <text x="${cx + LW / 2}" y="${cy + 24}" text-anchor="middle" class="lad-t1">${esc(clip(t1, 24))}</text><text x="${cx + LW / 2 + 8}" y="${cy + LH - 6}" text-anchor="middle" class="lad-t2">${esc(clip(t2, 21))}</text></g>
      ${ro ? "" : `<g class="lad-el lad-orplus" ${act(ro, "lad-or", `data-uid="${l.uid}" aria-label="Add an OR branch to ${esc(leafText(l))}"`)}><title>OR: add an alternative to this condition</title><circle cx="${cx + 13}" cy="${cy + LH - 12}" r="8.5" class="lad-pc lad-pc--or"/><text x="${cx + 13}" y="${cy + LH - 8}" text-anchor="middle" class="lad-pt lad-pt--sm">+</text></g>`}`;
  };
  const draw = (n, cx, cy, depth) => {
    if (n.kind === "leaf") return contact(cx, cy, n);
    const sz = lay(n);
    // Nested groups can share a corner: inset each box and shift its label by depth.
    const inset = 2 + (depth - 1) * 4;
    let out = depth ? `<g class="lad-grp" ${act(ro, "lad-group", `data-uid="${n.uid}" aria-label="${n.op === "all" ? "All" : "Any"} of these group"`)}><rect x="${cx + inset}" y="${cy + inset}" width="${sz.w * LW - 2 * inset}" height="${sz.h * LH - 2 * inset}" rx="8" class="lad-box"/><text x="${cx + 8 + (depth - 1) * 50}" y="${cy + 12}" class="lad-glabel">${n.op === "all" ? "ALL OF" : "ANY OF"}</text></g>` : "";
    if (n.op === "all") {
      let xx = cx;
      for (const c of n.children) { const s = lay(c); out += draw(c, xx, cy, depth + 1); xx += s.w * LW; }
    } else {
      let yy = cy;
      const W2 = sz.w * LW;
      for (const c of n.children) {
        const s = lay(c);
        out += draw(c, cx, yy, depth + 1);
        if (s.w * LW < W2) out += `<line x1="${cx + s.w * LW}" x2="${cx + W2}" y1="${yy + LH / 2}" y2="${yy + LH / 2}" class="lad-wire"/>`;
        yy += s.h * LH;
      }
      const lastMid = yy - lay(n.children[n.children.length - 1]).h * LH + LH / 2;
      out += `<line x1="${cx}" x2="${cx}" y1="${cy + LH / 2}" y2="${lastMid}" class="lad-wire"/><line x1="${cx + W2}" x2="${cx + W2}" y1="${cy + LH / 2}" y2="${lastMid}" class="lad-wire"/>`;
    }
    return out;
  };
  svg += `<line x1="${x0}" x2="${x0}" y1="${top - 6}" y2="${rungBottom + 6}" class="lad-rail"/>`;
  svg += `<line x1="${x0}" x2="${x}" y1="${mid}" y2="${mid}" class="lad-wire"/>`;
  if (evTrig) {
    svg += `<g class="lad-el" ${act(ro, "lad-trigger", `aria-label="Trigger: ${esc(triggerText(d.when))}"`)}><rect x="${x}" y="${top}" width="${LW}" height="${LH}" class="lad-hit"/><line x1="${x}" x2="${x + LW}" y1="${mid}" y2="${mid}" class="lad-wire"/><path d="M${x + LW / 2 - 12} ${mid - 11} l8 11 -8 11 M${x + LW / 2 + 4} ${mid - 11} l8 11 -8 11" class="lad-sym" fill="none"/><text x="${x + LW / 2}" y="${top + 14}" text-anchor="middle" class="lad-t1">EVENT</text><text x="${x + LW / 2}" y="${top + LH - 6}" text-anchor="middle" class="lad-t2">${esc(clip(triggerText(d.when), 24))}</text></g>`;
    x += LW;
  }
  if (d.condition) {
    svg += draw(d.condition, x, top, 0);
    if (orBlock) svg += `<g class="lad-el lad-orblock" ${act(ro, "lad-or-all", 'aria-label="Add an OR branch to the whole condition"')}><title>OR: an alternative to all of these conditions</title><rect x="${x}" y="${condBottom + 8}" width="66" height="24" rx="12" class="lad-pc lad-pc--or"/><text x="${x + 33}" y="${condBottom + 24}" text-anchor="middle" class="lad-pill">+ OR</text></g>`;
    x += cs.w * LW;
  }
  if (!ro && d.when.type === "metric") {
    svg += `<g class="lad-el lad-plus" ${act(ro, "lad-add-leaf", 'aria-label="Add a condition in series"')}><title>AND: another condition in series</title><line x1="${x}" x2="${x + 40}" y1="${mid}" y2="${mid}" class="lad-wire"/><circle cx="${x + 20}" cy="${mid}" r="11" class="lad-pc"/><text x="${x + 20}" y="${mid + 4.5}" text-anchor="middle" class="lad-pt">+</text></g>`;
    x += 40;
  }
  if (d.when.type === "metric" && d.hold > 0) {
    svg += `<line x1="${x}" x2="${x + 12}" y1="${mid}" y2="${mid}" class="lad-wire"/><g class="lad-el" ${act(ro, "lad-timer", 'data-t="hold" aria-label="Hold time"')}><rect x="${x + 12}" y="${mid - 17}" width="80" height="34" rx="6" class="lad-timer"/><text x="${x + 52}" y="${mid - 2}" text-anchor="middle" class="lad-tt">HOLD</text><text x="${x + 52}" y="${mid + 11}" text-anchor="middle" class="lad-t2">${d.hold} s</text></g><line x1="${x + 92}" x2="${x + 104}" y1="${mid}" y2="${mid}" class="lad-wire"/>`;
    x += 104;
  }
  const bus = Math.max(x, W - 200);
  svg += `<line x1="${x}" x2="${bus}" y1="${mid}" y2="${mid}" class="lad-wire"/>`;
  const coilRows = d.actions.length + (ro ? 0 : 1);
  if (coilRows > 1) svg += `<line x1="${bus}" x2="${bus}" y1="${mid}" y2="${mid + (coilRows - 1) * LH}" class="lad-wire"/>`;
  svg += `<g class="lad-el" ${act(ro, "lad-timer", 'data-t="cooldown" aria-label="Minimum interval"')}><text x="${bus + 8}" y="${top - 8}" class="lad-cap">INTERVAL ${d.cooldown} s</text></g>`;
  d.actions.forEach((a, i) => {
    const cy = mid + i * LH;
    const cx = bus + 66;
    const [l1, l2] = coilLabel(a);
    const err = !ro && ruleIssues(d).some((x) => x.path.startsWith(`actions#${a.uid}`) && x.level === "block" && shown(x.path));
    svg += `<g class="lad-el ${err ? "lad-err" : ""}" ${act(ro, "lad-coil", `data-uid="${a.uid}" aria-label="Action: ${esc(actionText(a))}"`)}><rect x="${bus + 2}" y="${cy - LH / 2}" width="${W - bus - 22}" height="${LH}" class="lad-hit"/><line x1="${bus}" x2="${cx - 16}" y1="${cy}" y2="${cy}" class="lad-wire"/>
      <path d="M${cx - 8} ${cy - 14} q-10 14 0 28 M${cx + 8} ${cy - 14} q10 14 0 28" class="lad-sym" fill="none"/><text x="${cx}" y="${cy + 4.5}" text-anchor="middle" class="lad-glyph">${coilGlyph(d, a)}</text>
      <line x1="${cx + 16}" x2="${W - 20}" y1="${cy}" y2="${cy}" class="lad-wire"/><text x="${cx + 26}" y="${cy - 8}" class="lad-t1">${esc(clip(l1, 18))}</text><text x="${cx + 26}" y="${cy + 18}" class="lad-t2">${esc(clip(l2, 20))}</text></g>`;
  });
  if (!ro) {
    const cy = mid + d.actions.length * LH;
    svg += `<g class="lad-el lad-plus" ${act(ro, "lad-add-coil", 'aria-label="Add an action"')}><line x1="${bus}" x2="${bus + 54}" y1="${cy}" y2="${cy}" class="lad-wire"/><circle cx="${bus + 66}" cy="${cy}" r="11" class="lad-pc"/><text x="${bus + 66}" y="${cy + 4.5}" text-anchor="middle" class="lad-pt">+</text></g>`;
  }
  svg += `<line x1="${W - 20}" x2="${W - 20}" y1="${top - 6}" y2="${rungBottom + 6}" class="lad-rail"/>`;
  let H = rungBottom + 14;
  // The clear rung (re-arm reading rules) or the reset rung (latch).
  const reverts = canClear(d) ? d.actions.filter((a) => a.type === "actuator" && a.revert) : [];
  const clearCoils = [...reverts.map((a) => ({ a, l: [actName(a), "→ " + unesc(fmtVal(clearValueOf(a)))] })), ...(canClear(d) && d.clearNotify ? [{ a: null, l: ["Notify", "on clear"] }] : [])];
  if (clearCoils.length || d.behaviour === "latch") {
    const t2 = H + 26;
    const m2 = t2 + LH / 2;
    const rows2 = Math.max(1, clearCoils.length);
    svg += `<text x="${x0 + 6}" y="${t2 - 10}" class="lad-cap">${d.behaviour === "latch" ? "RESET" : "WHEN IT CLEARS"}</text><line x1="${x0}" x2="${x0}" y1="${t2 - 4}" y2="${t2 + rows2 * LH + 4}" class="lad-rail"/><line x1="${W - 20}" x2="${W - 20}" y1="${t2 - 4}" y2="${t2 + rows2 * LH + 4}" class="lad-rail"/>`;
    let cx = x0 + 8;
    const lbl = d.behaviour === "latch" ? ["Reset latch", "by a person"] : ["Condition", "is false again"];
    svg += `<g class="lad-el" ${act(ro, d.behaviour === "latch" ? "lad-timer" : "lad-timer", `data-t="${d.behaviour === "latch" ? "latch" : "clear"}" aria-label="${lbl.join(" ")}"`)}><rect x="${cx}" y="${t2}" width="${LW}" height="${LH}" class="lad-hit"/><line x1="${x0}" x2="${cx + LW / 2 - 10}" y1="${m2}" y2="${m2}" class="lad-wire"/><line x1="${cx + LW / 2 + 10}" x2="${cx + LW}" y1="${m2}" y2="${m2}" class="lad-wire"/><line x1="${cx + LW / 2 - 10}" x2="${cx + LW / 2 - 10}" y1="${m2 - 11}" y2="${m2 + 11}" class="lad-sym"/><line x1="${cx + LW / 2 + 10}" x2="${cx + LW / 2 + 10}" y1="${m2 - 11}" y2="${m2 + 11}" class="lad-sym"/>${d.behaviour === "latch" ? "" : `<line x1="${cx + LW / 2 - 8}" x2="${cx + LW / 2 + 8}" y1="${m2 + 9}" y2="${m2 - 9}" class="lad-sym"/>`}<text x="${cx + LW / 2}" y="${t2 + 14}" text-anchor="middle" class="lad-t1">${lbl[0]}</text><text x="${cx + LW / 2}" y="${t2 + LH - 6}" text-anchor="middle" class="lad-t2">${lbl[1]}</text></g>`;
    cx += LW;
    if (d.behaviour !== "latch" && d.clearDelay > 0) {
      svg += `<line x1="${cx}" x2="${cx + 12}" y1="${m2}" y2="${m2}" class="lad-wire"/><g class="lad-el" ${act(ro, "lad-timer", 'data-t="clearDelay" aria-label="Clear delay"')}><rect x="${cx + 12}" y="${m2 - 17}" width="80" height="34" rx="6" class="lad-timer"/><text x="${cx + 52}" y="${m2 - 2}" text-anchor="middle" class="lad-tt">CLEAR</text><text x="${cx + 52}" y="${m2 + 11}" text-anchor="middle" class="lad-t2">${d.clearDelay} s</text></g>`;
      cx += 104;
    }
    svg += `<line x1="${cx}" x2="${bus}" y1="${m2}" y2="${m2}" class="lad-wire"/>`;
    const list = d.behaviour === "latch" ? [{ a: null, l: ["Unlatch", "re-arms the rule"], g: "R" }] : clearCoils;
    if (list.length > 1) svg += `<line x1="${bus}" x2="${bus}" y1="${m2}" y2="${m2 + (list.length - 1) * LH}" class="lad-wire"/>`;
    list.forEach((c, i) => {
      const cy = m2 + i * LH;
      const ccx = bus + 66;
      svg += `<g class="lad-el" ${act(ro, c.a ? "lad-coil" : "lad-timer", c.a ? `data-uid="${c.a.uid}" aria-label="On clear: ${esc(actionText(c.a, true))}"` : `data-t="${d.behaviour === "latch" ? "latch" : "clear"}" aria-label="${c.l.join(" ")}"`)}><rect x="${bus + 2}" y="${cy - LH / 2}" width="${W - bus - 22}" height="${LH}" class="lad-hit"/><line x1="${bus}" x2="${ccx - 16}" y1="${cy}" y2="${cy}" class="lad-wire"/><path d="M${ccx - 8} ${cy - 14} q-10 14 0 28 M${ccx + 8} ${cy - 14} q10 14 0 28" class="lad-sym" fill="none"/><text x="${ccx}" y="${cy + 4.5}" text-anchor="middle" class="lad-glyph">${c.g || (c.a ? "" : "!")}</text><line x1="${ccx + 16}" x2="${W - 20}" y1="${cy}" y2="${cy}" class="lad-wire"/><text x="${ccx + 26}" y="${cy - 8}" class="lad-t1">${esc(clip(c.l[0], 18))}</text><text x="${ccx + 26}" y="${cy + 18}" class="lad-t2">${esc(clip(c.l[1], 20))}</text></g>`;
    });
    H = t2 + rows2 * LH + 12;
  }
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="lad-svg" role="group" aria-label="Ladder view of the rule">${svg}</svg>`;
}
function issueOnLeaf(l) { return ED && ruleIssues(ED.draft).some((x) => x.path.startsWith(`leaf#${l.uid}`) && x.level === "block" && shown(x.path)); }
function ladderVertical(d, ro) {
  const btn = (a, attrs, inner, cls = "") => (ro ? `<div class="vl-el ${cls}">${inner}</div>` : `<button type="button" class="vl-el ${cls}" data-act="${a}" data-lad="1" ${attrs}>${inner}</button>`);
  const leaf = (l) => { const [t1, t2, nc] = leafShort(l); return `<li class="vl-leaf">${btn("lad-leaf", `data-uid="${l.uid}"`, `<span class="vl-sym" aria-hidden="true">${nc ? "[/]" : "[ ]"}</span><span class="vl-txt"><b>${esc(t1)}</b><small>${esc(t2)}</small></span>${issueOnLeaf(l) ? ic("alert", 14, "icon-err") : ""}`, "vl-contact")}${ro ? "" : `<button type="button" class="vl-or" data-act="lad-or" data-lad="1" data-uid="${l.uid}" aria-label="Add an OR branch to ${esc(leafText(l))}">${ic("plus", 13)}or</button>`}</li>`; };
  const node = (n, depth) => {
    if (n.kind === "leaf") return leaf(n);
    const sep = `<li class="vl-sep" aria-hidden="true">${n.op === "all" ? "AND" : "OR"}</li>`;
    const inner = n.children.map((c) => node(c, depth + 1)).join(sep);
    if (!depth) return inner;
    return `<li class="vl-grp vl-grp--${n.op}">${btn("lad-group", `data-uid="${n.uid}"`, `${n.op === "all" ? "ALL OF" : "ANY OF"}`, "vl-glabel")}<ol>${inner}</ol></li>`;
  };
  const coil = (a) => { const [l1, l2] = coilLabel(a); return `<li>${btn("lad-coil", `data-uid="${a.uid}"`, `<span class="vl-sym" aria-hidden="true">(${coilGlyph(d, a) || "&nbsp;"})</span><span class="vl-txt"><b>${esc(l1)}</b><small>${esc(l2)}</small></span>`, "vl-coil")}</li>`; };
  let html = `<div class="vlad" role="group" aria-label="Ladder view of the rule"><div class="vl-cap">${esc(triggerText(d.when))}${d.condition && d.condition.kind === "group" ? ` · ${d.condition.op === "all" ? "all" : "any"} of` : ""}</div><ol class="vl-rung">`;
  if (d.when.type !== "metric") html += `<li>${btn("lad-trigger", "", `<span class="vl-sym" aria-hidden="true">[⇢]</span><span class="vl-txt"><b>Event</b><small>${esc(triggerText(d.when))}</small></span>`, "vl-contact")}</li>${d.condition ? '<li class="vl-sep" aria-hidden="true">AND</li>' : ""}`;
  if (d.condition) html += node(d.condition, 0);
  if (!ro && d.condition) html += `<li>${btn("lad-or-all", "", `${ic("plus", 14)} OR: an alternative to all of the above`, "vl-plus")}</li>`;
  if (!ro && d.when.type === "metric") html += `<li>${btn("lad-add-leaf", "", `${ic("plus", 14)} AND: another condition in series`, "vl-plus")}</li>`;
  if (d.when.type === "metric" && d.hold > 0) html += `<li>${btn("lad-timer", 'data-t="hold"', `<span class="vl-sym" aria-hidden="true">⏱</span><span class="vl-txt"><b>Hold ${d.hold} s</b><small>true this long first</small></span>`, "vl-timer")}</li>`;
  html += `<li class="vl-bus">${btn("lad-timer", 'data-t="cooldown"', `then · interval ${d.cooldown} s`, "vl-buslabel")}</li>${d.actions.map(coil).join("")}`;
  if (!ro) html += `<li>${btn("lad-add-coil", "", `${ic("plus", 14)} Action`, "vl-plus")}</li>`;
  html += "</ol>";
  const reverts = canClear(d) ? d.actions.filter((a) => a.type === "actuator" && a.revert) : [];
  if (reverts.length || (canClear(d) && d.clearNotify)) {
    html += `<div class="vl-cap">When it clears${d.clearDelay ? ` · after ${d.clearDelay} s` : ""}</div><ol class="vl-rung vl-rung--clear">${btn("lad-timer", 'data-t="clear"', `<span class="vl-sym" aria-hidden="true">[/]</span><span class="vl-txt"><b>Condition is false</b><small>${d.clearDelay ? `for ${d.clearDelay} s` : "no delay"}</small></span>`, "vl-contact").replace(/^/, "<li>") + "</li>"}${reverts.map((a) => `<li>${btn("lad-coil", `data-uid="${a.uid}"`, `<span class="vl-sym" aria-hidden="true">( )</span><span class="vl-txt"><b>${esc(actName(a))}</b><small>→ ${unesc(fmtVal(clearValueOf(a)))}</small></span>`, "vl-coil")}</li>`).join("")}${d.clearNotify ? `<li>${btn("lad-timer", 'data-t="clear"', `<span class="vl-sym" aria-hidden="true">(!)</span><span class="vl-txt"><b>Notify</b><small>on clear</small></span>`, "vl-coil")}</li>` : ""}</ol>`;
  }
  if (d.behaviour === "latch") html += `<div class="vl-cap">Reset</div><ol class="vl-rung vl-rung--clear"><li>${btn("lad-timer", 'data-t="latch"', `<span class="vl-sym" aria-hidden="true">[ ]</span><span class="vl-txt"><b>Reset latch</b><small>by a person → re-arms</small></span>`, "vl-contact")}</li></ol>`;
  return html + "</div>";
}
