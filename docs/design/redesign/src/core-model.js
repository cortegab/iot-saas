/* core-model.js — the device/template draft (DESIGN.md §8): parts bring
   metrics and actuators, metrics are the record that lasts. Validation, change
   summary, save, and the field renderers the three editors arrange differently. */

const boardName = (id) => BOARDS.find((b) => b.id === id)?.name ?? "No board";
const pinName = (n) => PIN_LABEL[n] || "GPIO " + n;
const topicOf = (key, dev = "{device}") => `${WORKSPACE.slug}/${dev}/${key}`;
const UNITS = ["°C", "°F", "%", "lx", "g", "°/s", "L/min", "m/min", "A", "V", "W", "kWh", "ppm", "hPa", "dBm", "s"];

/* ---------- Usage: what rules and widgets point at a template's keys ---------- */
function usageFor(tplId) {
  const u = { metrics: {}, actuators: {} };
  if (!tplId) return u;
  const devs = DEVICES.filter((d) => d.tpl === tplId).map((d) => d.id);
  const add = (map, k, what) => { map[k] ||= { rules: 0, widgets: 0 }; map[k][what]++; };
  for (const r of RULES) {
    const refs = ruleRefs(r);
    for (const k of new Set(refs.metrics.filter(([dv]) => devs.includes(dv)).map(([, m]) => m))) add(u.metrics, k, "rules");
    for (const k of new Set(refs.actuators.filter(([dv]) => devs.includes(dv)).map(([, a]) => a))) add(u.actuators, k, "rules");
  }
  for (const db of DASHBOARDS) for (const w of db.widgets) if (devs.includes(w.device)) {
    if (w.metric) add(u.metrics, w.metric, "widgets");
    if (w.actuator) add(u.actuators, w.actuator, "widgets");
  }
  return u;
}
const usageText = (x) => (x ? [x.rules && plural(x.rules, "rule"), x.widgets && plural(x.widgets, "widget")].filter(Boolean).join(" and ") : "");

/* ---------- Draft ---------- */
function tplDraft(t) {
  const d = clone(t);
  delete d.id;
  d.parts ||= [];
  d.board ||= null;
  for (const r of [...d.metrics, ...d.actuators]) { r.origKey = r.key; r.keyAuto = false; }
  for (const m of d.metrics) { m.unit ??= ""; m.decimals ??= 1; m.min ??= null; m.max ??= null; m.interval ??= 30; m.deadband ??= null; m.publish ??= "periodic"; }
  for (const a of d.actuators) { a.on ??= "1"; a.off ??= "0"; a.allowed ??= ""; }
  return d;
}
const blankDraft = (runsOn = "our", device = null) => ({ name: "", runsOn, enabled: true, board: runsOn === "our" ? "esp32-30" : null, parts: [], metrics: [], actuators: [], device });
const allRows = (d) => [...d.metrics, ...d.actuators];
function uniqueKey(d, base, skipUid) {
  base = base || "metric";
  let k = base, n = 2;
  while (allRows(d).some((r) => r.uid !== skipUid && r.key === k) || ["status", "config"].includes(k)) k = `${base}_${n++}`;
  return k;
}
function uniqueName(d, base) {
  let k = base, n = 2;
  while (allRows(d).some((r) => r.name === k)) k = `${base} ${n++}`;
  return k;
}
function usedPins(d, skipPart) {
  const used = new Set();
  for (const p of d.parts) if (p.uid !== skipPart) for (const v of Object.values(p.pins)) if (v != null) used.add(v);
  if (d.parts.some((p) => DRIVERS[p.driver].i2c)) (I2C_DEFAULT[d.board] || []).forEach((x) => used.add(x));
  return used;
}
function freePin(d, role, kind, skipPart) {
  const used = usedPins(d, skipPart);
  const i2c = I2C_DEFAULT[d.board] || [];
  return (PINS[d.board] || []).find((n) => !used.has(n) && !i2c.includes(n) && (!role.adc || (ADC1[d.board] || []).includes(n)) && (kind !== "outputs" || !(INPUT_ONLY[d.board] || []).includes(n))) ?? null;
}
function attachChannel(d, p, c) {
  const dr = DRIVERS[p.driver];
  if (dr.kind === "inputs") {
    const m = { uid: uid("m"), key: uniqueKey(d, c.key), name: uniqueName(d, c.label), type: c.type === "bool" ? "bool" : "number", unit: c.unit || "", decimals: c.decimals ?? 1, min: null, max: null, publish: c.type === "bool" ? "on_change" : "periodic", interval: 30, deadband: null, keyAuto: true };
    d.metrics.push(m);
    p.channels[c.key] = m.uid;
  } else {
    const a = { uid: uid("a"), key: uniqueKey(d, c.key), name: uniqueName(d, c.label), control: "onoff", on: "1", off: "0", allowed: "", keyAuto: true };
    d.actuators.push(a);
    p.channels[c.key] = a.uid;
  }
}
function addPart(d, driverKey) {
  const dr = DRIVERS[driverKey];
  const p = { uid: uid("p"), driver: driverKey, pins: {}, params: {}, channels: {} };
  d.parts.push(p);
  for (const r of dr.pins || []) p.pins[r.role] = freePin(d, r, dr.kind, p.uid);
  for (const prm of dr.params) p.params[prm.key] = prm.def ?? (prm.bool ? false : null);
  const hasCommon = dr.channels.some((c) => c.common);
  for (const c of dr.channels) if (!hasCommon || c.common) attachChannel(d, p, c);
  return p;
}
const fedRows = (d, p) => Object.values(p.channels).map((id) => allRows(d).find((r) => r.uid === id)).filter(Boolean);
function dropRows(d, ids) {
  d.metrics = d.metrics.filter((m) => !ids.includes(m.uid));
  d.actuators = d.actuators.filter((a) => !ids.includes(a.uid));
}
function replacePart(d, p, driverKey) {
  const dr = DRIVERS[driverKey];
  const old = fedRows(d, p);
  p.driver = driverKey;
  p.channels = {};
  p.params = {};
  for (const prm of dr.params) p.params[prm.key] = prm.def ?? (prm.bool ? false : null);
  const pins = {};
  for (const r of dr.pins || []) pins[r.role] = Object.values(p.pins)[0] ?? freePin(d, r, dr.kind, p.uid);
  p.pins = pins;
  const pool = [...old];
  const hasCommon = dr.channels.some((c) => c.common);
  for (const c of dr.channels) {
    if (hasCommon && !c.common) continue;
    const wantBool = c.type === "bool" || c.type === "onoff";
    const i = pool.findIndex((r) => (dr.kind === "inputs" ? (r.type === "bool") === wantBool : true));
    if (i >= 0) { p.channels[c.key] = pool[i].uid; pool.splice(i, 1); }
    else attachChannel(d, p, c);
  }
}
const unwired = (d, row) => d.runsOn === "our" && !d.parts.some((p) => Object.values(p.channels).includes(row.uid));
const feederOf = (d, row) => d.parts.find((p) => Object.values(p.channels).includes(row.uid));

/* ---------- Validation (paths match the fields) ---------- */
function validateTpl(d) {
  const E = {}, W = {};
  if (d.device) { if (!d.device.name.trim()) E["device.name"] = "Name the device."; }
  else if (!d.name.trim()) E.name = "Give the template a name.";
  if (d.runsOn === "our") {
    if (!d.board) E.board = "Pick the board.";
    const used = {};
    if (d.parts.some((p) => DRIVERS[p.driver].i2c)) (I2C_DEFAULT[d.board] || []).forEach((x) => (used[x] = "the I2C bus"));
    for (const p of d.parts) {
      const dr = DRIVERS[p.driver];
      for (const r of dr.pins || []) {
        const pin = p.pins[r.role];
        const path = `parts#${p.uid}.pins.${r.role}`;
        if (pin == null || pin === "") E[path] = "Pick a pin.";
        else if (!(PINS[d.board] || []).includes(pin)) E[path] = `The ${boardName(d.board)} has no ${pinName(pin)}.`;
        else if (used[pin]) E[path] = `${pinName(pin)} is also used by ${used[pin]}.`;
        else if (r.adc && !(ADC1[d.board] || []).includes(pin)) E[path] = "Analog needs an ADC1 pin.";
        else if (dr.kind === "outputs" && (INPUT_ONLY[d.board] || []).includes(pin)) E[path] = `${pinName(pin)} is input-only.`;
        if (pin != null) used[pin] ||= dr.name;
      }
    }
    if (!d.parts.length) W.parts = "No parts yet, so the firmware has nothing to read or switch.";
  }
  const keys = {};
  for (const [kind, rows] of [["metrics", d.metrics], ["actuators", d.actuators]]) {
    for (const r of rows) {
      const p = `${kind}#${r.uid}`;
      if (!r.name.trim()) E[p + ".name"] = "Name it.";
      const k = r.key.trim();
      if (!k) E[p + ".key"] = "A key is needed.";
      else if (!/^[a-z0-9][a-z0-9_-]*$/.test(k)) E[p + ".key"] = "Lowercase letters, digits, _ and - only.";
      else if (["status", "config"].includes(k)) E[p + ".key"] = `“${k}” is reserved.`;
      else if (keys[k]) E[p + ".key"] = `Already used by ${keys[k]}.`;
      keys[k] ||= r.name || k;
      if (kind === "metrics") {
        if (r.type === "number" && r.min != null && r.max != null && r.min > r.max) E[p + ".max"] = "Max must be at least min.";
        if (r.publish === "streaming") W[p + ".publish"] = "Streaming sends every reading; it's heavy on data.";
        if (r.publish === "periodic" && (r.interval == null || r.interval < 1)) E[p + ".interval"] = "At least 1 s.";
      } else if (r.control === "values" && !String(r.allowed || "").trim()) E[p + ".allowed"] = "List at least one value.";
    }
  }
  return { E, W };
}
const sectionOf = (path) => (/^(device|name|enabled|runsOn)/.test(path) ? "general" : /^(board|parts)/.test(path) ? "hardware" : path.startsWith("metrics") ? "metrics" : path.startsWith("actuators") ? "actuators" : "general");
const errCount = (prefix) => edErrors(prefix).length;

/* ---------- Change summary ---------- */
function tplDiff(a, b) {
  const L = [];
  if (a.name !== b.name) L.push(`Name: ${a.name || "—"} → ${b.name}`);
  if (a.enabled !== b.enabled) L.push(`Status: ${b.enabled ? "Enabled" : "Disabled"}`);
  if (a.board !== b.board) L.push(`Board: ${boardName(a.board)} → ${boardName(b.board)}`);
  const ids = (xs) => xs.map((x) => x.uid);
  for (const p of b.parts) if (!ids(a.parts).includes(p.uid)) L.push(`Added ${DRIVERS[p.driver].name}`);
  for (const p of a.parts) if (!ids(b.parts).includes(p.uid)) L.push(`Removed ${DRIVERS[p.driver].name}`);
  for (const p of b.parts) { const o = a.parts.find((x) => x.uid === p.uid); if (o && JSON.stringify(o) !== JSON.stringify(p)) L.push(`${DRIVERS[p.driver].name}: wiring changed`); }
  for (const kind of ["metrics", "actuators"]) {
    const noun = kind === "metrics" ? "Metric" : "Actuator";
    for (const r of b[kind]) {
      const o = a[kind].find((x) => x.uid === r.uid);
      if (!o) L.push(`${noun} ${r.name} added`);
      else {
        if (o.key !== r.key) L.push(`Key ${o.key} → ${r.key}`);
        if (o.name !== r.name) L.push(`${o.name} → ${r.name}`);
        else if (JSON.stringify(o) !== JSON.stringify(r) && o.key === r.key) L.push(`${r.name}: settings changed`);
      }
    }
    for (const r of a[kind]) if (!b[kind].some((x) => x.uid === r.uid)) L.push(`${noun} ${r.name} removed`);
  }
  return L;
}
const changeSummary = (L) => (L.length ? `${plural(L.length, "change")}: ${L.slice(0, 3).map(esc).join("; ")}${L.length > 3 ? "; …" : ""}` : "");

/* ---------- Save ---------- */
/* The one-time credential handed to the connect flow. Kept in sessionStorage
   so a reload doesn't lose it before it's stored (audit: Connect flow). */
let CRED = (() => { try { return JSON.parse(sessionStorage.getItem("demo:cred")); } catch { return null; } })();
function persistCred() { try { if (CRED) sessionStorage.setItem("demo:cred", JSON.stringify(CRED)); else sessionStorage.removeItem("demo:cred"); } catch { /* private mode */ } }
function createDevice({ name, tplId, zone }) {
  const dev = { id: uid("d"), slug: slugOf(name), name, tpl: tplId, zone: zone || null, status: "never", seen: null };
  DEVICES.push(dev);
  CRED = { device: dev.id, secret: Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join(""), name, tpl: tplId };
  persistCred();
  return dev;
}
// A device created before a reload: put it back so its credential page still works.
if (CRED && !DEVICES.some((d) => d.id === CRED.device) && CRED.name) DEVICES.push({ id: CRED.device, slug: slugOf(CRED.name), name: CRED.name, tpl: CRED.tpl, zone: null, status: "never", seen: null });
function finalize(d) {
  const t = clone(d);
  for (const r of [...t.metrics, ...t.actuators]) { delete r.origKey; delete r.keyAuto; }
  delete t.device;
  return t;
}
async function saveTemplate(d, before, tplId) {
  if (d.device) {
    const twin = TEMPLATES.find((t) => t.enabled && t.runsOn === d.runsOn && t.board === d.board && JSON.stringify(t.metrics.map((m) => m.key).sort()) === JSON.stringify(d.metrics.map((m) => m.key).sort()) && d.metrics.length);
    let useTpl = null;
    if (twin) {
      const r = await confirmDlg({ title: `Matches ${esc(twin.name)}`, body: `${esc(twin.name)} has the same parts and data. Add this device to it, rather than make another template?`, confirm: `Use ${esc(twin.name)}`, cancel: "Make a new template", danger: false });
      if (r === "ok") useTpl = twin.id;
    }
    if (!useTpl) {
      const t = { ...finalize(d), id: uid("t-"), name: d.name.trim() || d.device.name.trim() };
      TEMPLATES.push(t);
      useTpl = t.id;
    }
    const dev = createDevice({ name: d.device.name.trim(), tplId: useTpl, zone: d.device.zone });
    ED.leaving = true;
    toast({ title: `${dev.name} created`, detail: "Next: its credential and Install." });
    navigate(`#/devices/${dev.id}/connect`);
    return true;
  }
  if (!tplId) {
    const t = { ...finalize(d), id: uid("t-") };
    TEMPLATES.push(t);
    ED.leaving = true;
    toast({ title: "Template created", detail: `${esc(t.name)} is ${t.enabled ? "available in Add device" : "disabled"}.` });
    navigate(`#/templates/${t.id}`);
    return true;
  }
  const t = tplById(tplId);
  const broken = [];
  const usage = usageFor(tplId);
  for (const kind of ["metrics", "actuators"]) for (const r of before[kind]) {
    const now = d[kind].find((x) => x.uid === r.uid);
    if ((!now || now.key !== r.key) && usage[kind][r.key]) broken.push(`${r.key}: used by ${usageText(usage[kind][r.key])}`);
  }
  if (broken.length) {
    const r = await confirmDlg({ title: "Save changes that disconnect keys?", body: "Rules and widgets that use these keys stop receiving data. Existing history stays under the old keys.", details: `<ul>${broken.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`, confirm: "Save anyway" });
    if (r !== "ok") return false;
  }
  Object.assign(t, finalize(d));
  const lines = tplDiff(before, d);
  for (const r of allRows(d)) { r.origKey = r.key; r.keyAuto = false; }
  ED.orig = clone(d);
  ED.touched.clear();
  ED.submitted = false;
  toast({ title: "Template saved", detail: changeSummary(lines) });
  render();
  return true;
}
function tplConsequence(d, tplId) {
  if (d.device) return "Creating it makes the device and its template together; next comes its credential and Install.";
  if (!tplId) return d.enabled ? "Creating it makes it available in Add device." : "It's created disabled, so it won't be offered in Add device yet.";
  const n = DEVICES.filter((x) => x.tpl === tplId).length;
  return n ? `Saving updates ${plural(n, "device")} and re-sends their telemetry profile within seconds.` : "No devices use it yet.";
}

/* ---------- Editor wiring for templates (shared by all demos) ---------- */
function openTplEditor({ key, init, tplId, noun, onSet }) {
  return useEditor(key, init, {
    validate: validateTpl,
    isNew: !tplId,
    noun,
    unlocked: new Set(),
    usage: usageFor(tplId),
    onSave: (d, before) => saveTemplate(d, before, tplId),
    onSet(path, v) {
      // A key follows its name until edited (DESIGN §8).
      const m = path.match(/^(metrics|actuators)#(\w+)\.(name|key)$/);
      if (m) {
        const row = getPath(ED.draft, `${m[1]}#${m[2]}`);
        if (m[3] === "key") row.keyAuto = false;
        else if (row.keyAuto) {
          row.key = uniqueKey(ED.draft, keyOf(v), row.uid);
          const el = document.getElementById(fid(`${m[1]}#${m[2]}.key`));
          if (el) el.value = row.key;
        }
      }
      if (path === "device.name" && ED.draft.device && !ED.draft.nameTouched) ED.draft.name = v;
      if (path === "board") for (const p of ED.draft.parts) for (const r of DRIVERS[p.driver].pins || []) if (p.pins[r.role] == null) p.pins[r.role] = freePin(ED.draft, r, DRIVERS[p.driver].kind, p.uid);
      onSet?.(path, v);
    },
  });
}

/* ---------- Field renderers ---------- */
function runsOnChoice(d) {
  const opt = (v, t, s) => `<button type="button" class="choice" role="radio" aria-checked="${d.runsOn === v}" data-act="runs-on" data-val="${v}"><span class="radio"></span><span><b>${t}</b><span>${s}</span></span></button>`;
  return `<div class="field"><span class="field-label" id="runs-on-l">Runs on</span><div class="choices" role="radiogroup" aria-labelledby="runs-on-l">
    ${opt("our", "Our firmware", "Pick the board and parts; installs from the browser.")}
    ${opt("custom", "Custom firmware", "List the data it sends; you write the firmware.")}
  </div></div>`;
}
function generalFields(d, { isNew }) {
  const zoneOpts = [{ v: "", l: "No zone" }, ...ZONES.map((z) => ({ v: z.id, l: z.name }))];
  if (d.device) {
    return `<div class="grid-2">${fld({ path: "device.name", label: "Device name", hint: "Shown in lists and alerts. Its MQTT id is made from it.", attrs: "autocomplete=off" })}${fld({ path: "device.zone", label: "Zone", optional: true, type: "select", options: zoneOpts })}</div>`;
  }
  return `<div class="grid-2">${fld({ path: "name", label: "Template name", hint: isNew ? "For example: Greenhouse node." : "" })}${isNew ? "" : switchFld({ path: "enabled", label: "Status", hint: "Offered in Add device.", hintOff: "Not offered in Add device. Existing devices keep working." })}</div>`;
}
function boardFields(d) {
  const groups = BOARDS.map((b) => ({ v: b.id, l: b.name, g: b.chip }));
  const b = BOARDS.find((x) => x.id === d.board);
  const caps = b ? [b.desc, b.caps.includes("ble") ? "Wi-Fi from a phone" : "Wi-Fi typed in", b.caps.includes("rgb_led") ? "RGB LED" : ""].filter(Boolean).join(" · ") : "";
  return `<div class="grid-2">${fld({ path: "board", label: "Board", type: "select", options: groups, hint: esc(caps), after: `<button class="btn btn--secondary" data-act="detect-board" title="Connect over USB to read the chip">${ic("usb", 15)}Detect</button>` })}</div>`;
}
function pinsText(d, p) {
  const dr = DRIVERS[p.driver];
  if (dr.i2c) return `I2C ${dr.address}`;
  return (dr.pins || []).map((r) => (p.pins[r.role] != null ? pinName(p.pins[r.role]) : "no pin")).join(", ");
}
function partLine(d, p, { act = "open-part", selected = false } = {}) {
  const dr = DRIVERS[p.driver];
  const rows = fedRows(d, p);
  const n = errCount(`parts#${p.uid}`);
  return `<button type="button" class="line ${n ? "has-err" : ""}" data-act="${act}" data-uid="${p.uid}" ${selected ? 'aria-current="true"' : ""}>
    ${ic(dr.kind === "inputs" ? "plug" : "toggle", 16, "muted")}
    <span class="l-main"><b>${esc(dr.name)}</b><span>${esc(pinsText(d, p))} · ${rows.length ? esc(rows.map((r) => r.name || r.key).join(", ")) : "no readings kept"}</span></span>
    <span class="l-end">${n ? `${ic("alert", 15, "icon-err")}<span class="sr-only">${plural(n, "problem")}</span>` : ""}${ic("chevR", 15)}</span>
  </button>`;
}
function partFields(d, p) {
  const dr = DRIVERS[p.driver];
  const pinOpts = (PINS[d.board] || []).map((n) => ({ v: n, l: pinName(n) }));
  const conn = dr.i2c
    ? `<p class="small muted">On the shared I2C bus: SDA ${pinName((I2C_DEFAULT[d.board] || [])[0])}, SCL ${pinName((I2C_DEFAULT[d.board] || [])[1])}, address <span class="mono">${dr.address}</span>.</p>`
    : `<div class="grid-2">${(dr.pins || []).map((r) => fld({ path: `parts#${p.uid}.pins.${r.role}`, label: `${r.label} pin`, type: "select", num: true, options: pinOpts, placeholder: "Pick a pin", hint: r.adc ? "ADC1 pins only." : "" })).join("")}</div>`;
  const many = dr.channels.length > 2;
  const readings = dr.channels.map((c) => {
    const rid = p.channels[c.key];
    const row = rid && allRows(d).find((r) => r.uid === rid);
    const kind = dr.kind === "inputs" ? "metrics" : "actuators";
    const keep = many ? `<input type="checkbox" class="check" aria-label="Keep ${esc(c.label)}" ${row ? "checked" : ""} data-act="keep-ch" data-uid="${p.uid}" data-ch="${c.key}">` : "";
    return `<div class="reading-row">${keep}<span class="r-ch">${esc(c.label)}</span><span class="muted" aria-hidden="true">→</span>${
      row ? `<input class="input" id="${fid(`${kind}#${row.uid}.name`)}" data-bind="${kind}#${row.uid}.name" value="${esc(row.name)}" aria-label="Name of what ${esc(c.label)} ${dr.kind === "inputs" ? "feeds" : "drives"}"><span class="tag tag--mono">${esc(row.key)}</span>` : `<span class="muted small grow">Not kept: makes no metric</span>`
    }</div>`;
  }).join("");
  const params = dr.params.length
    ? `<details class="disclosure"><summary>Driver settings</summary><div class="disc-body grid-2">${dr.params
        .map((prm) => (prm.bool ? switchFld({ path: `parts#${p.uid}.params.${prm.key}`, label: prm.label, on: "On", off: "Off" }) : fld({ path: `parts#${p.uid}.params.${prm.key}`, label: prm.label, type: "number" })))
        .join("")}</div></details>`
    : "";
  return `<div class="stack">
    <div><div class="field-label" style="margin-bottom:8px">Connection</div>${conn}</div>
    <div><div class="field-label" style="margin-bottom:8px">${dr.kind === "inputs" ? "Readings" : "Commands"}${many ? ' <span class="opt">tick the ones to keep</span>' : ""}</div><div class="readings">${readings}</div></div>
    ${params}
    <div class="row row--wrap"><button class="btn btn--secondary btn--sm" data-act="replace-part" data-uid="${p.uid}">Replace part</button><button class="btn btn--link-danger" data-act="rm-part" data-uid="${p.uid}">Remove part</button></div>
  </div>`;
}
function rowUsage(kind, row) {
  const u = ED?.usage?.[kind]?.[row.origKey];
  return row.origKey ? usageText(u) : "";
}
function rowLine(d, kind, row, { act = "open-row", selected = false } = {}) {
  const n = errCount(`${kind}#${row.uid}`);
  const used = rowUsage(kind, row);
  const sub = kind === "metrics"
    ? [row.type === "bool" ? "On/Off" : row.unit || "no unit", row.publish === "periodic" ? `every ${row.interval ?? "?"} s` : row.publish === "on_change" ? "on change" : "streaming"].join(" · ")
    : row.control === "onoff" ? "On / Off" : `values: ${row.allowed || "—"}`;
  return `<button type="button" class="line ${n ? "has-err" : ""}" data-act="${act}" data-kind="${kind}" data-uid="${row.uid}" ${selected ? 'aria-current="true"' : ""}>
    <span class="l-main"><b>${esc(row.name) || '<span class="muted">Unnamed</span>'}</b><span><span class="mono">${esc(row.key) || "no key"}</span> · ${esc(sub)}${used ? ` · used by ${used}` : ""}</span></span>
    <span class="l-end">${unwired(d, row) ? '<span class="tag" title="No part feeds this. Your firmware must publish it.">Not wired</span>' : ""}${n ? `${ic("alert", 15, "icon-err")}<span class="sr-only">${plural(n, "problem")}</span>` : ""}${ic("chevR", 15)}</span>
  </button>`;
}
function keyField(kind, row) {
  const p = `${kind}#${row.uid}`;
  const used = rowUsage(kind, row);
  const locked = !!used && !ED.unlocked.has(row.uid) && row.key === row.origKey;
  return fld({
    path: p + ".key", label: "Key", mono: true, disabled: locked,
    labelExtra: row.keyAuto ? ' <span class="opt">follows the name</span>' : locked ? ` ${ic("lock", 12)}<span class="sr-only">Locked: in use</span>` : "",
    hint: `<span class="mono">${esc(topicOf(row.key || "…"))}</span>${used ? ` · used by ${used}` : ""}`,
    after: locked ? `<button class="btn btn--link small" data-act="unlock" data-uid="${row.uid}">Unlock</button>` : "",
  });
}
function metricFields(d, m, { advancedOpen = false } = {}) {
  const p = `metrics#${m.uid}`;
  const unitOpts = [{ v: "", l: "No unit" }, ...UNITS.map((u) => ({ v: u, l: u }))];
  const feeder = feederOf(d, m);
  const pubSummary = m.type === "bool" ? (m.publish === "periodic" ? `Every ${m.interval} s` : m.publish === "on_change" ? "On change" : "Streaming") : `${m.publish === "periodic" ? `Every ${m.interval} s` : m.publish === "on_change" ? "On change" : "Streaming"} · ${plural(m.decimals ?? 0, "decimal")}${m.min != null || m.max != null ? ` · ${m.min ?? "…"} to ${m.max ?? "…"}` : ""}`;
  return `<div class="stack">
    <div class="grid-2">${fld({ path: p + ".name", label: "Name" })}${keyField("metrics", m)}</div>
    <div class="grid-2">
      <div class="field"><span class="field-label">Type</span>${seg(p + ".type", [["number", "Number"], ["bool", "On / Off"]], undefined, "Type")}<div class="hint">${m.type === "bool" ? "Reads On or Off; no unit." : ""}</div></div>
      ${m.type === "number" ? fld({ path: p + ".unit", label: "Unit", optional: true, type: "select", options: unitOpts }) : ""}
    </div>
    ${unwired(d, m) ? `<div class="callout">${ic("info", 16)}<span><b>Not wired.</b> No part feeds this metric, so your firmware must publish it on <span class="mono">${esc(topicOf(m.key))}</span>.</span></div>` : feeder ? `<p class="small muted">Fed by ${esc(DRIVERS[feeder.driver].name)} on ${esc(pinsText(d, feeder))}.</p>` : ""}
    <details class="disclosure" ${advancedOpen || edErrors(p + ".m").length || edErrors(p + ".i").length ? "open" : ""}><summary>Publishing and range <span class="muted" style="font-weight:400">· ${esc(pubSummary)}</span></summary><div class="disc-body stack">
      <div class="field"><span class="field-label">Publish</span>${seg(p + ".publish", [["periodic", "Every…"], ["on_change", "On change"], ["streaming", "Streaming"]], undefined, "Publish")}${edMsg(p + ".publish").warn ? `<div class="hint" style="color:var(--color-status-pending)">${esc(edMsg(p + ".publish").warn)}</div>` : ""}</div>
      <div class="grid-4">
        ${m.publish === "periodic" ? fld({ path: p + ".interval", label: "Every", type: "number", affix: "s" }) : ""}
        ${m.publish === "on_change" && m.type === "number" ? fld({ path: p + ".deadband", label: "Change of at least", optional: true, type: "number", affix: m.unit }) : ""}
        ${m.type === "number" ? fld({ path: p + ".decimals", label: "Decimals", type: "number" }) + fld({ path: p + ".min", label: "Min", optional: true, type: "number" }) + fld({ path: p + ".max", label: "Max", optional: true, type: "number" }) : ""}
      </div>
    </div></details>
    <div><button class="btn btn--link-danger" data-act="rm-row" data-kind="metrics" data-uid="${m.uid}">Remove metric</button></div>
  </div>`;
}
function actuatorFields(d, a) {
  const p = `actuators#${a.uid}`;
  return `<div class="stack">
    <div class="grid-2">${fld({ path: p + ".name", label: "Name" })}${keyField("actuators", a)}</div>
    <div class="field"><span class="field-label">Control</span>${seg(p + ".control", [["onoff", "On / Off"], ["values", "List of values"]], undefined, "Control")}<div class="hint">Commands go out on QoS 1 with a 30 s time limit.</div></div>
    ${a.control === "values" ? fld({ path: p + ".allowed", label: "Allowed values", hint: "Separated by commas, e.g. open, closed, half" }) : `<details class="disclosure"><summary>Payloads <span class="muted" style="font-weight:400">· sends ${esc(a.on)} for On, ${esc(a.off)} for Off</span></summary><div class="disc-body grid-2">${fld({ path: p + ".on", label: "Sends for On", mono: true })}${fld({ path: p + ".off", label: "Sends for Off", mono: true })}</div></details>`}
    ${unwired(d, a) ? `<p class="small muted"><span class="tag">Not wired</span> No part drives it; your firmware must subscribe to <span class="mono">${esc(topicOf("cmd/" + a.key))}</span>.</p>` : ""}
    <div><button class="btn btn--link-danger" data-act="rm-row" data-kind="actuators" data-uid="${a.uid}">Remove actuator</button></div>
  </div>`;
}
function whatYoullSee(d, { compact = false } = {}) {
  const ms = d.metrics.map((m) => `${esc(m.name || m.key || "Unnamed")}${unitOf(m) ? ` <span class="muted">${esc(m.unit)}</span>` : m.type === "bool" ? ' <span class="muted">On/Off</span>' : ""}`);
  const as = d.actuators.map((a) => esc(a.name || a.key || "Unnamed"));
  if (compact) return `<span>${ms.length ? ms.join(", ") : '<span class="muted">No metrics</span>'}</span>${as.length ? ` · <span>${as.join(", ")}</span>` : ""}`;
  return `<dl class="kv"><dt>Metrics</dt><dd>${ms.length ? ms.join(", ") : '<span class="muted">None yet</span>'}</dd><dt>Actuators</dt><dd>${as.length ? as.join(", ") : '<span class="muted">None</span>'}</dd></dl>`;
}
function addPartPicker() {
  const group = (kind, title) => `<h3 class="small muted" style="margin:6px 0 8px">${title}</h3><div class="lines" style="margin-bottom:16px">${Object.entries(DRIVERS)
    .filter(([, dr]) => dr.kind === kind)
    .map(([k, dr]) => `<button type="button" class="line" data-act="add-part" data-driver="${k}"><span class="l-main"><b>${esc(dr.name)}</b><span>${esc(dr.desc)}${dr.channels.length > 1 ? ` · ${dr.channels.length} readings` : ""}</span></span>${ic("plus", 15, "muted")}</button>`)
    .join("")}</div>`;
  openSheet({ title: "Add a part", sub: "It brings its metrics or actuators. You can rename them on the part.", body: group("inputs", "Sensors and inputs") + group("outputs", "Outputs"), label: "Add a part" });
}

/* ---------- Model actions ---------- */
Object.assign(ACT, {
  "runs-on": (el) => {
    const d = ED.draft;
    if (d.runsOn === el.dataset.val) return;
    d.runsOn = el.dataset.val;
    if (d.runsOn === "our") d.board ||= "esp32-30";
    else { d.parts = []; d.board = null; }
    ED.onRunsOn?.();
    render();
  },
  "detect-board": () => toast({ title: "Found an ESP32 (rev 3)", detail: "The list is narrowed to ESP32 boards. Pick your model: boards with the same chip look alike." }),
  "add-part-open": () => addPartPicker(),
  "add-part": (el) => {
    const p = addPart(ED.draft, el.dataset.driver);
    popOv();
    ED.onPartAdded?.(p);
    render();
    toast({ title: `${DRIVERS[p.driver].name} added`, detail: `It brings ${esc(fedRows(ED.draft, p).map((r) => r.name).join(", ")) || "nothing yet"}.` });
  },
  "rm-part": async (el) => {
    const d = ED.draft;
    const p = d.parts.find((x) => x.uid === el.dataset.uid);
    const rows = fedRows(d, p);
    const used = rows.filter((r) => r.origKey && rowUsage(r.uid.startsWith("a") ? "actuators" : "metrics", r));
    let keep = false;
    if (rows.length) {
      const r = await confirmDlg({
        title: `Remove ${esc(DRIVERS[p.driver].name)}?`,
        body: used.length ? `It feeds ${esc(rows.map((x) => x.name).join(", "))}, which rules or dashboards use. Keep them as metrics your firmware publishes, or remove them too.` : `It brings ${esc(rows.map((x) => x.name).join(", "))}. They're removed with it.`,
        confirm: used.length ? "Remove part and data" : "Remove part",
        alt: used.length ? "Keep the metrics" : null,
      });
      if (!r) return;
      keep = r === "alt";
    }
    d.parts = d.parts.filter((x) => x !== p);
    if (!keep) dropRows(d, rows.map((x) => x.uid));
    ED.onPartRemoved?.(p);
    render();
  },
  "replace-part": (el) => {
    const p = ED.draft.parts.find((x) => x.uid === el.dataset.uid);
    const kind = DRIVERS[p.driver].kind;
    openSheet({
      title: `Replace ${esc(DRIVERS[p.driver].name)}`,
      sub: "The new part keeps each reading's metric, so rules and dashboards keep working.",
      body: `<div class="lines">${Object.entries(DRIVERS).filter(([k, dr]) => dr.kind === kind && k !== p.driver).map(([k, dr]) => `<button class="line" data-act="replace-with" data-uid="${p.uid}" data-driver="${k}"><span class="l-main"><b>${esc(dr.name)}</b><span>${esc(dr.desc)}</span></span>${ic("chevR", 15)}</button>`).join("")}</div>`,
    });
  },
  "replace-with": (el) => {
    const p = ED.draft.parts.find((x) => x.uid === el.dataset.uid);
    const old = DRIVERS[p.driver].name;
    replacePart(ED.draft, p, el.dataset.driver);
    popOv();
    render();
    toast({ title: `${old} replaced by ${DRIVERS[p.driver].name}`, detail: "Its metrics stay." });
  },
  "keep-ch": (el) => {
    const d = ED.draft;
    const p = d.parts.find((x) => x.uid === el.dataset.uid);
    const c = DRIVERS[p.driver].channels.find((x) => x.key === el.dataset.ch);
    if (p.channels[c.key]) { dropRows(d, [p.channels[c.key]]); delete p.channels[c.key]; }
    else attachChannel(d, p, c);
    render();
  },
  "add-row": (el) => {
    const d = ED.draft;
    const kind = el.dataset.kind;
    const row = kind === "metrics"
      ? { uid: uid("m"), key: "", name: "", type: "number", unit: "", decimals: 1, min: null, max: null, publish: "periodic", interval: 30, deadband: null, keyAuto: true }
      : { uid: uid("a"), key: "", name: "", control: "onoff", on: "1", off: "0", allowed: "", keyAuto: true };
    d[kind].push(row);
    ED.onRowAdded?.(kind, row);
    render();
    setTimeout(() => document.getElementById(fid(`${kind}#${row.uid}.name`))?.focus(), 0);
  },
  "rm-row": async (el) => {
    const d = ED.draft;
    const kind = el.dataset.kind;
    const row = d[kind].find((x) => x.uid === el.dataset.uid);
    const used = rowUsage(kind, row);
    if (used) {
      const r = await confirmDlg({ title: `Remove ${esc(row.name)}?`, body: `${esc(row.key)} is used by ${used}. They stop receiving data; existing history stays.`, confirm: "Remove" });
      if (r !== "ok") return;
    }
    d[kind] = d[kind].filter((x) => x !== row);
    for (const p of d.parts) for (const k in p.channels) if (p.channels[k] === row.uid) delete p.channels[k];
    ED.onRowRemoved?.(kind, row);
    render();
  },
  unlock: (el) => { ED.unlocked.add(el.dataset.uid); render(); setTimeout(() => $(`#app [data-bind$="${el.dataset.uid}.key"]`)?.focus(), 0); },
});
