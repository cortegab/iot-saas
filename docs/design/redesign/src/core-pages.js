/* core-pages.js — the shared pages. Demo-specific
   pieces come from DEMO: shell(), frame(), templateEditor(), addDevice(),
   deviceSettings(), and optional list/peek layout hooks. */

const ph = ({ crumbs = [], over = "", title, desc = "", actions = "" }) => `
  ${crumbs.length ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map(([l, h]) => `<a href="${h}">${esc(l)}</a>${ic("chevR", 12)}`).join("")}</nav>` : ""}
  <header class="ph"><div class="ph-main">${over ? `<div class="ph-over">${over}</div>` : ""}<h1>${title}</h1>${desc ? `<p class="ph-desc">${desc}</p>` : ""}</div>${actions ? `<div class="ph-actions">${actions}</div>` : ""}</header>`;
const tabsNav = (base, tabs, cur) => `<div class="tabs" role="tablist">${tabs.map(([id, l, extra = ""]) => `<a role="tab" id="tab-${id}" href="${base}${id === tabs[0][0] ? "" : "?tab=" + id}" aria-selected="${id === cur}" tabindex="${id === cur ? 0 : -1}">${l}${extra}</a>`).join("")}</div>`;
const listState = (k, def) => (S.list[k] ||= { q: "", sort: "name", dir: 1, size: 25, ...def });
const sortTh = (list, key, label, cls = "") => {
  const L = S.list[list];
  const on = L.sort === key;
  return `<th class="${cls}" aria-sort="${on ? (L.dir > 0 ? "ascending" : "descending") : "none"}"><button data-act="sort" data-list="${list}" data-key="${key}">${label}${on ? ic(L.dir > 0 ? "chevU" : "chevD", 12) : ""}</button></th>`;
};
const searchBox = (list, ph_) => `<div class="search">${ic("search", 15)}<input class="input" id="q-${list}" type="search" placeholder="${ph_}" value="${esc(S.list[list].q)}" data-list="${list}" data-key="q" aria-label="${ph_}"></div>`;
const tblFoot = (shown, total, list) => `<div class="tbl-foot"><span>${shown ? `1–${shown} of ${total}` : `0 of ${total}`}</span><span class="grow"><label>Rows per page <select class="select" style="width:auto;height:28px;display:inline-block" data-list="${list}" data-key="size"><option>25</option><option>50</option><option>100</option></select></label></span></div>`;
function cmpBy(L, get) {
  return (a, b) => {
    const x = get(a, L.sort), y = get(b, L.sort);
    return (x > y ? 1 : x < y ? -1 : 0) * L.dir;
  };
}

/* List inputs (search, filter selects) */
document.addEventListener("input", (e) => {
  const el = e.target.closest("[data-list]");
  if (!el || el.tagName === "SELECT") return;
  S.list[el.dataset.list][el.dataset.key] = el.value;
  render();
});
document.addEventListener("change", (e) => {
  const el = e.target.closest("select[data-list]");
  if (el) { S.list[el.dataset.list][el.dataset.key] = el.value; render(); }
  const nav = e.target.closest("select[data-nav]");
  if (nav) guardNav(nav.value);
  const cm = e.target.closest("select[data-chart-metric]");
  if (cm) { S.chartMetric = cm.value; render(); }
});

Object.assign(ACT, {
  sort: (el) => {
    const L = S.list[el.dataset.list];
    if (L.sort === el.dataset.key) L.dir *= -1;
    else { L.sort = el.dataset.key; L.dir = 1; }
    render();
  },
  filter: (el) => { S.list[el.dataset.list][el.dataset.key] = el.dataset.val; render(); },
  "clear-filters": (el) => { Object.assign(S.list[el.dataset.list], { q: "", tpl: "", zone: "", st: "", sev: "" }); render(); },
  sel: (el) => {
    const id = el.dataset.id;
    if (id === "*") {
      const ids = filteredDevices().map((d) => d.id);
      const all = ids.every((i) => S.sel.has(i));
      ids.forEach((i) => (all ? S.sel.delete(i) : S.sel.add(i)));
    } else S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id);
    render();
  },
  peek: (el) => {
    const id = el.dataset.peek;
    const kind = el.dataset.kind || "device";
    S.peek = { kind, id };
    if (DEMO.inlinePeek?.(kind)) { render(); return; }
    openPeekSheet();
  },
  "peek-step": (el) => {
    const ids = peekIds(S.peek.kind);
    const i = ids.indexOf(S.peek.id);
    S.peek.id = ids[(i + +el.dataset.dir + ids.length) % ids.length];
    if (DEMO.inlinePeek?.(S.peek.kind)) { render(); return; }
    popOv();
    openPeekSheet();
  },
  "peek-close": () => { S.peek = null; render(); },
  "filters-sheet": (el) => openFiltersSheet(el.dataset.list),
  "dev-enable": (el) => setDevStatus([el.dataset.id], true),
  "dev-disable": (el) => setDevStatus([el.dataset.id], false),
  "dev-delete": (el) => deleteDevices([el.dataset.id]),
  "bulk-enable": () => setDevStatus([...S.sel], true),
  "bulk-disable": () => setDevStatus([...S.sel], false),
  "bulk-delete": () => deleteDevices([...S.sel]),
  "bulk-clear": () => { S.sel.clear(); render(); },
  "rotate": async (el) => {
    const d = devById(el.dataset.id);
    const r = await confirmDlg({ title: `Rotate ${esc(d.name)}'s credential?`, body: "The current password stops working now. The device disconnects until it gets the new one (Install or Update config only).", confirm: "Rotate credential" });
    if (r !== "ok") return;
    CRED = { device: d.id, secret: Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 10) }; persistCred();
    S.connect[d.id] = null;
    closeAllOv();
    navigate(`#/devices/${d.id}/connect`);
  },
  cmd: (el) => {
    const dev = el.dataset.dev, act = el.dataset.actKey;
    const v = el.dataset.val === "true" ? true : el.dataset.val === "false" ? false : el.dataset.val;
    const st = ((ACTUATORS[dev] ||= {})[act] ||= {});
    Object.assign(st, { requested: v, at: Date.now(), by: "user:" + WORKSPACE.user, pending: true, failed: false });
    COMMANDS.unshift({ id: uid("c"), device: dev, actuator: act, value: v, at: Date.now(), by: WORKSPACE.user, status: "pending" });
    render();
    if (devById(dev).status === "online") setTimeout(() => { st.reported = v; st.pending = false; COMMANDS[0].status = "confirmed"; render(); }, 1400);
  },
  "notif-read": (el) => { const n = NOTIFS.find((x) => x.id === el.dataset.id); n.read = !n.read; render(); },
  "notif-dismiss": (el) => {
    const i = NOTIFS.findIndex((x) => x.id === el.dataset.id);
    const [n] = NOTIFS.splice(i, 1);
    render();
    toast({ title: "Notification dismissed", undo: () => NOTIFS.splice(i, 0, n) });
  },
  "notif-all-read": () => { NOTIFS.forEach((n) => (n.read = true)); render(); toast({ title: "All marked as read" }); },
  "dash-edit": () => { S.dashEdit = !S.dashEdit; render(); },
  "w-move": (el) => {
    const db = DASHBOARDS.find((x) => x.id === el.dataset.db);
    const i = db.widgets.findIndex((w) => w.id === el.dataset.w);
    const j = i + +el.dataset.dir;
    if (j < 0 || j >= db.widgets.length) return;
    [db.widgets[i], db.widgets[j]] = [db.widgets[j], db.widgets[i]];
    render();
    setTimeout(() => $(`[data-act="w-move"][data-w="${el.dataset.w}"][data-dir="${el.dataset.dir}"]`)?.focus(), 0);
  },
  "w-size": (el) => {
    const db = DASHBOARDS.find((x) => x.id === el.dataset.db);
    const w = db.widgets.find((x) => x.id === el.dataset.w);
    w.span = Math.min(12, Math.max(3, w.span + +el.dataset.dir));
    render();
  },
  "w-remove": (el) => {
    const db = DASHBOARDS.find((x) => x.id === el.dataset.db);
    const i = db.widgets.findIndex((x) => x.id === el.dataset.w);
    const [w] = db.widgets.splice(i, 1);
    render();
    toast({ title: "Widget removed", undo: () => db.widgets.splice(i, 0, w) });
  },
  "w-add": (el) => {
    openSheet({ title: "Add a widget", body: `<div class="lines">${[["value", "Value card", "One live reading"], ["trend", "Trend chart", "A metric over time"], ["gauge", "Gauge", "A number against its range"], ["status", "Device status", "Online, last seen, signal"], ["actuator", "Actuator control", "Switch it On or Off"]].map(([t, l, s]) => `<button class="line" data-act="w-add-type" data-db="${el.dataset.db}" data-type="${t}"><span class="l-main"><b>${l}</b><span>${s}</span></span>${ic("plus", 15)}</button>`).join("")}</div>` });
  },
  "w-add-type": (el) => {
    const db = DASHBOARDS.find((x) => x.id === el.dataset.db);
    const t = el.dataset.type;
    db.widgets.push({ id: uid("w"), type: t, device: "d1", metric: t === "status" || t === "actuator" ? undefined : "temperature", actuator: t === "actuator" ? "fan1" : undefined, span: t === "trend" ? 8 : 4 });
    popOv();
    render();
    toast({ title: "Widget added", detail: "Pick its device and metric from its ⋯ menu." });
  },
  "rule-run": (el) => toast({ title: "Ran once", detail: `${esc(ruleById(el.dataset.id).name)}: condition is ${ruleById(el.dataset.id).state === "fired" ? "true" : "false"} now; no action sent outside its cooldown.` }),
  "reset-latch": (el) => { const r = ruleById(el.dataset.id); r.state = "armed"; render(); toast({ title: "Latch reset", detail: `${esc(r.name)} is armed again.` }); },
  "copy": (el) => { try { navigator.clipboard.writeText(el.dataset.val); } catch { /* demo */ } toast({ title: "Copied" }); },
  "login": () => navigate("#/dashboards/db1"),
  "start": (el) => { S.addStart = el.dataset.val; render(); },
});
MENUS.dev = (el) => {
  const d = devById(el.dataset.id);
  return [
    { label: "Open", href: `#/devices/${d.id}` },
    { label: d.status === "never" ? "Connect…" : "Install or reconnect…", href: `#/devices/${d.id}/connect` },
    { label: "Rotate credential…", act: "rotate", attrs: `data-id="${d.id}"` },
    d.status === "disabled" ? { label: "Enable", act: "dev-enable", attrs: `data-id="${d.id}"` } : { label: "Disable", act: "dev-disable", attrs: `data-id="${d.id}"` },
    "-",
    { label: "Delete…", act: "dev-delete", attrs: `data-id="${d.id}"`, danger: true },
  ];
};
MENUS.tpl = (el) => {
  const t = tplById(el.dataset.id);
  const n = DEVICES.filter((d) => d.tpl === t.id).length;
  return [
    { label: "Edit", href: `#/templates/${t.id}` },
    { label: "View devices", href: `#/devices`, act: "", attrs: "" },
    ...(t.runsOn === "our" ? [{ label: "Wiring guide", href: `#/templates/${t.id}/wiring` }] : []),
    { label: "Duplicate", act: "tpl-dup", attrs: `data-id="${t.id}"` },
    { label: t.enabled ? "Disable" : "Enable", act: "tpl-toggle", attrs: `data-id="${t.id}"` },
    "-",
    { label: "Delete…", act: "tpl-delete", attrs: `data-id="${t.id}"`, danger: true, hint: n ? plural(n, "device uses", "devices use") + " it" : "" },
  ];
};
MENUS.rule = (el) => {
  const r = ruleById(el.dataset.id);
  return [
    { label: "Open", href: `#/rules/${r.id}` },
    { label: "Run now", act: "rule-run", attrs: `data-id="${r.id}"` },
    ...(r.state === "latched" ? [{ label: "Reset latch", act: "reset-latch", attrs: `data-id="${r.id}"` }] : []),
    { label: "Duplicate", act: "rule-dup", attrs: `data-id="${r.id}"` },
    { label: r.enabled ? "Disable" : "Enable", act: "rule-toggle", attrs: `data-id="${r.id}"` },
    "-",
    { label: "Delete…", act: "rule-delete", attrs: `data-id="${r.id}"`, danger: true },
  ];
};
Object.assign(ACT, {
  "tpl-dup": (el) => { const t = tplById(el.dataset.id); const c = { ...clone(t), id: uid("t-"), name: t.name + " (copy)" }; TEMPLATES.push(c); toast({ title: "Template duplicated", detail: esc(c.name) }); navigate(`#/templates/${c.id}`); },
  "tpl-toggle": (el) => { const t = tplById(el.dataset.id); t.enabled = !t.enabled; render(); toast({ title: `${t.name} ${t.enabled ? "enabled" : "disabled"}`, undo: () => (t.enabled = !t.enabled) }); },
  "tpl-delete": async (el) => {
    const t = tplById(el.dataset.id);
    const n = DEVICES.filter((d) => d.tpl === t.id).length;
    if (n) { await confirmDlg({ title: `${esc(t.name)} is in use`, body: `${plural(n, "device uses", "devices use")} this template, so it can't be deleted. Move or delete them first, or disable the template.`, confirm: "OK", danger: false, cancel: "Close" }); return; }
    const r = await confirmDlg({ title: `Delete ${esc(t.name)}?`, body: "No devices use it. This can't be undone.", confirm: "Delete template" });
    if (r !== "ok") return;
    TEMPLATES.splice(TEMPLATES.indexOf(t), 1);
    if (ED) ED.leaving = true;
    toast({ title: `${t.name} deleted` });
    navigate("#/templates");
  },
  "rule-dup": (el) => { const r = ruleById(el.dataset.id); const c = { ...clone(r), id: uid("r"), name: r.name + " (copy)", enabled: false, state: "armed" }; RULES.push(c); navigate(`#/rules/${c.id}`); toast({ title: "Rule duplicated", detail: "The copy starts disabled." }); },
  "rule-toggle": (el) => { const r = ruleById(el.dataset.id); r.enabled = !r.enabled; render(); toast({ title: `${r.name} ${r.enabled ? "enabled" : "disabled"}`, undo: () => (r.enabled = !r.enabled) }); },
  "rule-delete": async (el) => {
    const r = ruleById(el.dataset.id);
    const ok = await confirmDlg({ title: `Delete ${esc(r.name)}?`, body: "It stops evaluating now. Its versions and history go with it.", confirm: "Delete rule" });
    if (ok !== "ok") return;
    const i = RULES.indexOf(r);
    RULES.splice(i, 1);
    if (ED) ED.leaving = true;
    navigate("#/rules");
    toast({ title: `${r.name} deleted`, undo: () => RULES.splice(i, 0, r) });
  },
});

/* ---------- Devices ---------- */
function filteredDevices() {
  const L = listState("devices", { tpl: "", zone: "", st: "" });
  const q = L.q.toLowerCase();
  return DEVICES.filter((d) => (!q || d.name.toLowerCase().includes(q) || tplOf(d).name.toLowerCase().includes(q) || d.slug.includes(q)) && (!L.tpl || d.tpl === L.tpl) && (!L.zone || d.zone === L.zone) && (!L.st || d.status === L.st))
    .sort(cmpBy(L, (d, k) => (k === "seen" ? d.seen || 0 : k === "tpl" ? tplOf(d).name : k === "zone" ? zoneName(d.zone) : k === "status" ? d.status : d.name.toLowerCase())));
}
function setDevStatus(ids, enable) {
  const go = () => {
    const prev = ids.map((id) => [id, devById(id).status]);
    ids.forEach((id) => { const d = devById(id); d.status = enable ? (d.seen ? "offline" : "never") : "disabled"; });
    S.sel.clear();
    render();
    toast({ title: `${plural(ids.length, "device")} ${enable ? "enabled" : "disabled"}`, undo: () => prev.forEach(([id, st]) => (devById(id).status = st)) });
  };
  if (!enable && ids.length > 1) {
    confirmDlg({ title: `Disable ${plural(ids.length, "device")}?`, body: "Disabled devices can't connect, and rules stop evaluating them.", confirm: "Disable", danger: false }).then((r) => r === "ok" && go());
  } else go();
}
async function deleteDevices(ids) {
  const ds = ids.map(devById);
  const rules = RULES.filter((r) => ruleUses(r, ids)).length;
  const widgets = DASHBOARDS.flatMap((db) => db.widgets).filter((w) => ids.includes(w.device)).length;
  const one = ds.length === 1;
  const r = await confirmDlg({
    title: one ? `Delete ${esc(ds[0].name)}?` : `Delete ${plural(ds.length, "device")}?`,
    body: `This deletes ${one ? "its" : "their"} credential and history, and can't be undone.${rules || widgets ? ` ${[rules && plural(rules, "rule"), widgets && plural(widgets, "dashboard widget")].filter(Boolean).join(" and ")} use ${one ? "it" : "them"} and will stop working.` : ""}`,
    confirm: one ? "Delete device" : `Delete ${plural(ds.length, "device")}`,
    alt: "Disable instead",
  });
  if (r === "alt") return setDevStatus(ids, false);
  if (r !== "ok") return;
  ids.forEach((id) => DEVICES.splice(DEVICES.findIndex((d) => d.id === id), 1));
  S.sel.clear();
  closeAllOv();
  if (S.path.startsWith("/devices/")) navigate("#/devices");
  else render();
  toast({ title: one ? `${ds[0].name} deleted` : `${plural(ds.length, "device")} deleted` });
}
function devKpis(L) {
  const c = (st) => DEVICES.filter((d) => d.status === st).length;
  const k = (st, label, sub) => `<button class="kpi" data-act="filter" data-list="devices" data-key="st" data-val="${L.st === st ? "" : st}" aria-pressed="${L.st === st}"><span class="k-l">${badge([label, DEV_ST[st][1], DEV_ST[st][2]]).replace(`<span class="lbl">${label}</span>`, `<span class="lbl">${label}</span>`)}</span><span class="k-v">${c(st)}</span><span class="k-s">${sub}</span></button>`;
  return `<div class="kpis" role="group" aria-label="Filter by status">${k("online", "Online", `of ${DEVICES.length} devices`)}${k("offline", "Offline", "not reporting now")}${k("never", "Never connected", "waiting for first message")}${k("disabled", "Disabled", "not evaluated by rules")}</div>`;
}
function chipsFor(list, defs) {
  const L = S.list[list];
  const on = defs.filter(([k]) => L[k]);
  return on.length || L.q ? `<div class="chips">${on.map(([k, label, nameOf]) => `<button class="chip" data-act="filter" data-list="${list}" data-key="${k}" data-val="" aria-label="Remove filter ${esc(label)}: ${esc(nameOf(L[k]))}">${esc(label)}: ${esc(nameOf(L[k]))} ${ic("x", 12)}</button>`).join("")}<button class="btn btn--link small" data-act="clear-filters" data-list="${list}">Clear all</button></div>` : "";
}
function openFiltersSheet(list) {
  const L = S.list[list];
  const sel = (key, label, opts) => `<div class="field"><label for="fs-${key}">${label}</label><select class="select" id="fs-${key}" data-list="${list}" data-key="${key}"><option value="">All</option>${opts.map(([v, l]) => `<option value="${v}" ${L[key] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
  const body = list === "devices"
    ? sel("st", "Status", Object.entries(DEV_ST).map(([k, v]) => [k, v[0]])) + sel("tpl", "Template", TEMPLATES.map((t) => [t.id, t.name])) + sel("zone", "Zone", ZONES.map((z) => [z.id, z.name]))
    : sel("sev", "Severity", SEV.map((s) => [s, SEV_TONE[s][0]]));
  openSheet({ title: "Filters", bottom: true, body: `<div class="stack">${body}</div>`, foot: `<button class="btn btn--ghost" data-act="clear-filters" data-list="${list}">Clear all</button><button class="btn btn--primary" data-act="ov-close">Show results</button>` });
}
function devicesTable(rows, { selectable = true, compact = false } = {}) {
  const allSel = rows.length && rows.every((d) => S.sel.has(d.id));
  return `<div class="tbl-wrap"><table class="tbl ${selectable ? "" : "no-check"}"><caption class="sr-only">Devices</caption><thead><tr>
    ${selectable ? `<th class="w-check"><input type="checkbox" class="check" aria-label="Select all shown" data-act="sel" data-id="*" ${allSel ? "checked" : ""}></th>` : ""}
    ${sortTh("devices", "name", "Device")}${compact ? "" : sortTh("devices", "tpl", "Template", "col-p3") + sortTh("devices", "zone", "Zone", "col-p2")}${sortTh("devices", "status", "Status")}${sortTh("devices", "seen", "Last seen", "r")}<th class="w-menu"><span class="sr-only">Actions</span></th>
  </tr></thead><tbody>${rows
    .map((d) => `<tr data-act="peek" data-peek="${d.id}" tabindex="0" class="${d.status === "disabled" ? "is-disabled" : ""}" aria-selected="${S.peek?.id === d.id}">
      ${selectable ? `<td class="w-check"><input type="checkbox" class="check" aria-label="Select ${esc(d.name)}" data-act="sel" data-id="${d.id}" ${S.sel.has(d.id) ? "checked" : ""}></td>` : ""}
      <td><div class="cell-name"><a href="#/devices/${d.id}">${esc(d.name)}</a><span class="sub"><span class="mono">${esc(d.slug)}</span>${compact ? "" : `<span class="fold fold-p3"> · ${esc(tplOf(d).name)}</span><span class="fold fold-p2"> · ${esc(zoneName(d.zone))}</span>`}${d.ownWiring ? " · Own wiring" : ""}</span></div></td>
      ${compact ? "" : `<td class="col-p3 c-extra">${esc(tplOf(d).name)}</td><td class="col-p2 c-extra">${esc(zoneName(d.zone))}</td>`}
      <td class="c-status">${devBadge(d.status)}</td><td class="r c-seen num nowrap" data-seen="${d.status === "online" ? d.id : ""}">${agoEl(d.seen)}</td>
      <td class="w-menu">${menuBtn("dev", `Actions for ${d.name}`, `data-id="${d.id}"`)}</td></tr>`)
    .join("")}</tbody></table>
    ${rows.length ? tblFoot(rows.length, DEVICES.length, "devices") : `<div class="empty"><b>No devices match</b><button class="btn btn--secondary" data-act="clear-filters" data-list="devices">Clear filters</button></div>`}</div>`;
}
function pageDevices() {
  const L = listState("devices", { tpl: "", zone: "", st: "" });
  const rows = filteredDevices();
  const nf = [L.tpl, L.zone, L.st].filter(Boolean).length;
  const toolbar = `<div class="toolbar">${searchBox("devices", "Search name or template")}
    <select class="select" data-list="devices" data-key="tpl" aria-label="Template"><option value="">All templates</option>${TEMPLATES.map((t) => `<option value="${t.id}" ${L.tpl === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
    <select class="select" data-list="devices" data-key="zone" aria-label="Zone"><option value="">All zones</option>${ZONES.map((z) => `<option value="${z.id}" ${L.zone === z.id ? "selected" : ""}>${esc(z.name)}</option>`).join("")}</select>
    <button class="btn btn--secondary filters-btn" data-act="filters-sheet" data-list="devices">${ic("filter", 14)}Filters${nf ? ` (${nf})` : ""}</button>
    <span class="result-count">${rows.length} of ${DEVICES.length}</span></div>`;
  const chips = chipsFor("devices", [["st", "Status", (v) => DEV_ST[v][0]], ["tpl", "Template", (v) => tplById(v).name], ["zone", "Zone", zoneName]]);
  const bulk = S.sel.size ? `<div class="bulkbar" role="region" aria-label="Bulk actions"><b>${S.sel.size} selected</b><button class="btn btn--secondary btn--sm" data-act="bulk-enable">Enable</button><button class="btn btn--secondary btn--sm" data-act="bulk-disable">Disable</button><button class="btn btn--secondary btn--sm" data-act="bulk-delete" style="color:var(--color-status-error)">Delete…</button><button class="btn btn--link small" data-act="bulk-clear">Clear selection</button></div>` : "";
  const list = `${toolbar}${chips}${bulk}${devicesTable(rows, { compact: DEMO.compactDevices?.() })}`;
  const head = ph({ title: "Devices", desc: `${plural(DEVICES.length, "device")}. Open a device for its readings and controls.`, actions: `<a class="btn btn--primary" href="#/devices/new">${ic("plus", 15)}Add device</a>` });
  return DEMO.listLayout ? DEMO.listLayout("device", head + devKpis(L), list) : `<div class="page">${head}${devKpis(L)}${list}</div>`;
}
const peekIds = (kind) => (kind === "device" ? filteredDevices().map((d) => d.id) : kind === "template" ? TEMPLATES.map((t) => t.id) : RULES.map((r) => r.id));
function peekBody(kind, id) {
  if (kind === "template") return tplPeek(tplById(id));
  const d = devById(id);
  if (!d) return "";
  const t = tplOf(d);
  const rd = READINGS[d.id] || {};
  return `<div class="stack">
    <div class="row">${devBadge(d.status)}<span class="muted small">· last message ${agoEl(d.seen)}</span></div>
    <dl class="kv"><dt>Template</dt><dd><a href="#/templates/${t.id}">${esc(t.name)}</a>${d.ownWiring ? " · Own wiring" : ""}</dd><dt>Zone</dt><dd>${esc(zoneName(d.zone))}</dd>${d.fw ? `<dt>Firmware</dt><dd>${esc(d.fw)}</dd>` : ""}${d.rssi ? `<dt>Signal</dt><dd>${d.rssi} dBm</dd>` : ""}${d.battery ? `<dt>Battery</dt><dd>${d.battery} %</dd>` : ""}</dl>
    ${t.metrics.length ? `<div><h3 class="field-label" style="margin-bottom:8px">Latest readings</h3><div class="lines">${t.metrics.map((m) => { const v = rd[m.key]; return `<div class="line"><span class="l-main"><b>${esc(m.name)}</b></span><span class="num ${d.status !== "online" ? "is-stale" : ""}">${v ? fmtReading(m, v[0]) + " " + esc(unitOf(m)) : '<span class="muted">No data</span>'}</span></div>`; }).join("")}</div></div>` : ""}
  </div>`;
}
function peekHead(kind, id) {
  const ids = peekIds(kind);
  const i = ids.indexOf(id);
  const name = kind === "template" ? tplById(id)?.name : devById(id)?.name;
  const href = kind === "template" ? `#/templates/${id}` : `#/devices/${id}`;
  return { name, href, nav: `<div class="row"><button class="btn btn--icon" data-act="peek-step" data-dir="-1" aria-label="Previous">${ic("chevL")}</button><span class="small muted num">${i + 1} of ${ids.length}</span><button class="btn btn--icon" data-act="peek-step" data-dir="1" aria-label="Next">${ic("chevR")}</button></div>` };
}
function openPeekSheet() {
  const { kind, id } = S.peek;
  const h = peekHead(kind, id);
  openSheet({
    title: esc(h.name), label: `${h.name} (peek)`,
    body: peekBody(kind, id),
    foot: `${h.nav}<span class="grow"></span>${menuBtn(kind === "template" ? "tpl" : "dev", "More actions", `data-id="${id}"`)}<a class="btn btn--primary" href="${h.href}">${kind === "template" ? "Edit" : "Open device"}</a>`,
    onClose: () => { S.peek = null; },
  });
}

/* ---------- Device page ---------- */
const freshness = (d, m, r) => {
  if (!r || r[0] == null) return ["No data", "unknown"];
  const maxAge = (m.publish === "periodic" ? (m.interval || 30) * 3 : m.publish === "streaming" ? 30 : 24 * 3600) * 1000;
  return d.status === "online" && Date.now() - r[1] < maxAge ? ["Live", "online"] : ["Stale", "unknown"];
};
function readoutsHtml(d) {
  const t = tplOf(d);
  const rd = READINGS[d.id] || {};
  if (!t.metrics.length) return `<p class="muted">This template has no metrics.</p>`;
  return `<div class="readouts">${t.metrics.map((m) => {
    const r = rd[m.key];
    const [f, tone] = freshness(d, m, r);
    return `<div class="readout ${f === "Stale" ? "is-stale" : ""}"><div class="r-l">${esc(m.name)}<span class="badge tone-${tone}" style="margin-left:auto"><span class="dot ${f === "Live" ? "" : "dot--sq"}"></span><span class="lbl small">${f}</span></span></div>
      <div class="r-v num" data-readout="${f === "Live" ? d.id + ":" + m.key : ""}">${r && r[0] != null ? fmtReading(m, r[0]) : "—"}${unitOf(m) && r?.[0] != null ? `<small>${esc(m.unit)}</small>` : ""}</div>
      <div class="r-s">${r && r[1] ? (f === "Stale" ? `Last value, ${agoEl(r[1])}` : agoEl(r[1])) : "Nothing received yet"}</div></div>`;
  }).join("")}</div>`;
}
function trendCard(d) {
  const t = tplOf(d);
  if (!t.metrics.length) return "";
  const key = t.metrics.some((m) => m.key === S.chartMetric) ? S.chartMetric : t.metrics[0].key;
  const m = t.metrics.find((x) => x.key === key);
  const rule = { threshold: thresholdFor(d.id, key) };
  return `<section class="card card-pad" aria-labelledby="trend-h"><div class="chart-h"><h3 id="trend-h">Trend</h3>
    <select class="select" style="width:auto" data-chart-metric aria-label="Metric">${t.metrics.map((x) => `<option value="${x.key}" ${x.key === key ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
    <span class="grow"></span>${rangeSeg(S.range)}</div>
    ${chartHtml("dev-" + d.id, { dev: d.id, key, range: S.range, bool: m.type === "bool", threshold: rule?.threshold, unit: m.unit, never: d.status === "never", until: d.status === "online" ? undefined : d.seen, label: `${m.name} over the last ${S.range}` })}</section>`;
}
function healthHtml(d) {
  return `<dl class="kv">${[["Signal", d.rssi ? `${d.rssi} dBm` : "—"], ["Battery", d.battery ? `${d.battery} %` : "Mains"], ["Firmware", d.fw || "—"], ["Uptime", d.uptime ? `${Math.floor(d.uptime / DAY)} d ${Math.floor((d.uptime % DAY) / HOUR)} h` : "—"], ["MQTT id", `<span class="mono">${esc(d.slug)}</span>`]].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
}
function actuatorRows(d) {
  const t = tplOf(d);
  if (!t.actuators.length) return `<p class="muted">This template has no actuators.</p>`;
  return `<div class="lines">${t.actuators.map((a) => {
    const st = ACTUATORS[d.id]?.[a.key] || {};
    const opts = a.control === "onoff" ? [[true, "On"], [false, "Off"]] : String(a.allowed).split(",").map((s) => [s.trim(), s.trim()]);
    const val = (v) => (v == null ? '<span class="muted">unknown</span>' : `<b>${fmtVal(v)}</b>`);
    const status = st.pending
      ? `<span class="tone-pending">Waiting for the device to confirm · <span data-deadline="${st.at + 30e3}">${Math.max(0, Math.ceil((st.at + 30e3 - Date.now()) / 1000))}</span> s left</span>`
      : st.failed ? `<span class="tone-offline">No response within 30 s.</span> <button class="btn btn--link small" data-act="cmd" data-dev="${d.id}" data-act-key="${a.key}" data-val="${st.requested}">Retry</button>`
      : st.requested != null && st.reported != null && st.requested === st.reported ? '<span class="tone-online">Confirmed</span>' : "";
    const by = st.by ? (st.by.startsWith("rule:") ? `rule <a href="#/rules/${st.by.slice(5)}">${esc(ruleById(st.by.slice(5))?.draft.name || "")}</a>` : esc(st.by.slice(5))) : "";
    return `<div class="line act-row" style="flex-wrap:wrap"><span class="l-main"><b>${esc(a.name)}</b>
        <span class="req-rep"><span>Requested ${val(st.requested)}</span><span>Device reports ${val(st.reported)}</span></span>
        <span style="white-space:normal">${status}${st.at ? `${status ? " · " : ""}${by ? "sent by " + by + ", " : ""}${agoEl(st.at)}` : "Nothing sent yet"}</span>
        ${d.status !== "online" ? `<span class="small" style="white-space:normal">Queued in its desired state; applies when it reconnects, if within 30 s.</span>` : ""}</span>
      <div class="seg" role="group" aria-label="Set ${esc(a.name)}">${opts.map(([v, l]) => `<button aria-pressed="${st.requested === v}" data-act="cmd" data-dev="${d.id}" data-act-key="${a.key}" data-val="${v}" ${d.status === "disabled" ? "disabled" : ""}>${esc(l)}</button>`).join("")}</div></div>`;
  }).join("")}</div>`;
}
function pageDevice(id) {
  const d = devById(id);
  if (!d) return `<div class="page"><div class="empty"><b>Device not found</b><a href="#/devices">Back to devices</a></div></div>`;
  const t = tplOf(d);
  const tab = S.q.get("tab") || "overview";
  const rules = RULES.filter((r) => ruleUses(r, [d.id]));
  const settingsErr = ED && ED.key === "dev:" + d.id && edErrors().length ? '<span class="err-dot" aria-label="has problems"></span>' : "";
  const head = ph({
    crumbs: [["Devices", "#/devices"]],
    over: `${esc(t.name)} · ${esc(zoneName(d.zone))}`,
    title: esc(d.name),
    desc: `${devBadge(d.status)} <span class="muted">· last message <span data-seen="${d.status === "online" ? d.id : ""}">${agoEl(d.seen)}</span></span>`,
    actions: `${d.status === "never" ? `<a class="btn btn--primary" href="#/devices/${d.id}/connect">Connect</a>` : `<a class="btn btn--secondary" href="#/devices/${d.id}/connect">Install</a>`}${menuBtn("dev", "More actions", `data-id="${d.id}"`)}`,
  });
  let body = "";
  if (tab === "overview") {
    body = `${d.status === "offline" ? `<div class="callout callout--warn" style="margin-bottom:16px">${ic("wifi", 16)}<span><b>Offline since ${absTime(d.seen)}.</b> Readings below are the last ones received.</span></div>` : d.status === "never" ? `<div class="callout" style="margin-bottom:16px">${ic("info", 16)}<span><b>Waiting for its first message.</b> <a href="#/devices/${d.id}/connect">Connect it</a> to see readings here.</span></div>` : ""}
      <div class="stack" style="gap:20px">${readoutsHtml(d)}${trendCard(d)}<section class="card card-pad"><h3 class="sec-h" style="font-size:15px;margin-bottom:12px">Health</h3>${healthHtml(d)}</section></div>`;
  } else if (tab === "controls") {
    const CF = (S.cmdFilter ||= { st: "", act: "" });
    const cmds = COMMANDS.filter((c) => c.device === d.id && (!CF.st || c.status === CF.st) && (!CF.act || c.actuator === CF.act));
    const result = (c) => (c.status === "confirmed" ? badge(["Confirmed", "online", ""]) : c.status === "pending" ? badge(["Pending", "pending", "ring"]) : badge(["No response", "offline", "sq"]));
    body = `${d.status !== "online" && t.actuators.length ? `<div class="callout callout--warn" style="margin-bottom:16px">${ic("wifi", 16)}<span>The device is ${DEV_ST[d.status][0].toLowerCase()}. Commands wait in its desired state and apply when it reconnects, if still within their 30 s time limit.</span></div>` : ""}
      ${actuatorRows(d)}
      <div class="cmd-head"><h3>Command timeline</h3><div class="cmd-filters">
        <div class="seg" role="radiogroup" aria-label="Result">${[["", "All"], ["pending", "Pending"], ["confirmed", "Confirmed"], ["no_response", "No response"]].map(([v, l]) => `<button role="radio" aria-checked="${CF.st === v}" tabindex="${CF.st === v ? 0 : -1}" data-act="cmd-f" data-k="st" data-val="${v}">${l}</button>`).join("")}</div>
        ${t.actuators.length > 1 ? `<select class="select" style="width:auto" data-cmdf aria-label="Actuator"><option value="">All actuators</option>${t.actuators.map((a) => `<option value="${a.key}" ${CF.act === a.key ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>` : ""}</div></div>
      ${cmds.length ? `<ol class="timeline timeline--cmd">${cmds.map((c) => `<li><span class="num small muted nowrap c-time">${absTime(c.at, true)}</span><span class="grow c-what"><b>${esc(t.actuators.find((a) => a.key === c.actuator)?.name || c.actuator)} → ${fmtVal(c.value)}</b><span class="small muted"> · ${c.by.startsWith("rule:") ? `rule <a href="#/rules/${c.by.slice(5)}">${esc(ruleById(c.by.slice(5))?.draft.name)}</a>` : esc(c.by)}</span></span>${result(c)}</li>`).join("")}</ol>` : `<p class="muted">No commands match.</p>`}`;
  } else if (tab === "rules") {
    body = rules.length ? `<div class="lines">${rules.map((r) => `<a class="line" href="#/rules/${r.id}" style="text-decoration:none"><span class="l-main"><b>${esc(r.name)}</b><span>${esc(ruleSentence(r, true))}</span></span><span class="l-end">${ruleBadge(r)}${ic("chevR", 15)}</span></a>`).join("")}</div>` : `<div class="empty"><b>No rules use this device</b><a class="btn btn--secondary" href="#/rules/new">New rule</a></div>`;
  } else {
    body = DEMO.deviceSettings(d);
  }
  return `<div class="page ${tab === "settings" ? "page--editor" : ""}">${head}${tabsNav(`#/devices/${d.id}`, [["overview", "Overview"], ["controls", "Controls"], ["rules", `Rules <span class="count">${rules.length}</span>`], ["settings", "Settings", settingsErr]], tab)}${body}</div>`;
}

/* Device settings: the shared editor model, arranged by DEMO.frame. */
function deviceSettingsSpec(d) {
  const t = tplOf(d);
  useEditor("dev:" + d.id, () => ({ name: d.name, zone: d.zone || "", enabled: d.status !== "disabled" }), {
    noun: d.name,
    validate: (x) => ({ E: x.name.trim() ? {} : { name: "Name the device." }, W: {} }),
    onSave: (x, before) => {
      const L = [];
      if (x.name !== before.name) L.push(`Name: ${before.name} → ${x.name}`);
      if (x.zone !== before.zone) L.push(`Zone: ${zoneName(before.zone)} → ${zoneName(x.zone)}`);
      if (x.enabled !== before.enabled) L.push(`Status: ${x.enabled ? "Enabled" : "Disabled"}`);
      d.name = x.name.trim(); d.zone = x.zone || null;
      if (x.enabled !== before.enabled) d.status = x.enabled ? (d.seen ? "offline" : "never") : "disabled";
      ED.orig = clone(x); ED.touched.clear();
      toast({ title: "Device saved", detail: changeSummary(L) });
      render();
    },
  });
  const n = RULES.filter((r) => ruleUses(r, [d.id])).length;
  return {
    consequence: "Saving applies right away. Renaming keeps its MQTT id, so the device doesn't need a new install.",
    sections: [
      { id: "general", title: "General", body: `<div class="grid-2">${fld({ path: "name", label: "Name", hint: "Shown in lists, dashboards and alerts." })}${fld({ path: "zone", label: "Zone", optional: true, type: "select", options: [{ v: "", l: "No zone" }, ...ZONES.map((z) => ({ v: z.id, l: z.name }))] })}</div>` },
      { id: "status", title: "Rule evaluation", lead: n ? `${plural(n, "rule")} use${n === 1 ? "s" : ""} this device.` : "No rules use this device.", body: switchFld({ path: "enabled", label: "Status", hint: "It can connect, and rules evaluate its readings.", hintOff: "It can't connect, and rules don't evaluate it." }) },
      { id: "template", title: "Template", lead: "A device keeps the template it was added with.", body: `<dl class="kv"><dt>Template</dt><dd><a href="#/templates/${t.id}">${esc(t.name)}</a> · ${t.runsOn === "our" ? "Our firmware" : "Custom firmware"}</dd><dt>Wiring</dt><dd>${t.runsOn !== "our" ? "—" : d.ownWiring ? "Own wiring (overrides the template's)" : `The template's · <a href="#/templates/${t.id}/wiring">Wiring guide</a>`}</dd><dt>Gives it</dt><dd>${whatYoullSee(t, { compact: true })}</dd></dl>` },
      { id: "connection", title: "Connection", body: `<dl class="kv"><dt>MQTT username</dt><dd><span class="mono">${esc(d.id)}</span> <button class="btn btn--link small" data-act="copy" data-val="${esc(d.id)}">Copy</button></dd><dt>Password</dt><dd>Shown once when created. <button class="btn btn--link small" data-act="rotate" data-id="${d.id}">Rotate credential…</button></dd><dt>Topics</dt><dd><div class="code">${esc(topicOf("{metric}", d.slug))}\n${esc(topicOf("cmd/{actuator}", d.slug))}\n${esc(topicOf("status", d.slug))}</div></dd></dl>` },
      { id: "danger", title: "Delete", danger: true, body: `<div class="row row--wrap"><p class="grow muted small">Deletes its credential and history. Rules and widgets that use it stop working.</p><button class="btn btn--secondary" style="color:var(--color-status-error)" data-act="dev-delete" data-id="${d.id}">Delete device…</button></div>` },
    ],
    saveLabel: "Save",
  };
}

/* ---------- Connect flow ---------- */
S.connect = {};
function pageConnect(id) {
  const d = devById(id);
  const t = tplOf(d);
  const C = (S.connect[id] ||= { step: CRED?.device === id ? 0 : 3, stored: false, inst: null, wifi: BOARDS.find((b) => b.id === t.board)?.caps.includes("ble") ? "phone" : "typed", live: null, acks: {} });
  const steps = ["Credential", "Install", "Wi-Fi", "Live check"];
  const nav = `<ol class="wiz-steps" aria-label="Connect steps">${steps.map((s, i) => `<li class="${i < C.step ? "done" : ""}" ${i === C.step ? 'aria-current="step"' : ""}><span class="n" aria-hidden="true">${i < C.step ? ic("check", 12) : i + 1}</span>${s}<span class="sr-only">${i < C.step ? " (done)" : i === C.step ? " (current)" : ""}</span></li>`).join("")}</ol>
    <div class="wiz-compact"><div class="row"><span>Step <b>${C.step + 1} of 4</b> · ${steps[C.step]}</span></div><div class="progress"><div style="width:${((C.step + 1) / 4) * 100}%"></div></div></div>`;
  let body = "";
  let foot = "";
  const back = C.step > 0 ? `<button class="btn btn--ghost" data-act="cn-step" data-id="${id}" data-dir="-1">${ic("chevL", 15)}Back</button>` : "";
  const next = (label = "Continue", dis = false) => { foot = `${back}<button class="btn btn--primary" data-act="cn-step" data-id="${id}" data-dir="1" ${dis ? "disabled" : ""}>${label}${ic("chevR", 15)}</button>`; return ""; };
  // Leaving before storing the one-time password asks first.
  if (C.step === 0 && CRED?.device === id && !C.stored) S.guard = () => ({ title: "Leave before storing the password?", body: "It's shown only once. If you leave now, you'll have to rotate the credential to get a new one.", confirm: "Leave anyway" });
  if (C.step === 0) {
    body = CRED?.device === id
      ? `<h2 class="sec-h" style="font-size:17px">Store its credential</h2><p class="sec-lead">The device signs in to the broker with these. The password is shown once and stored hashed.</p>
        <div class="stack"><div class="field"><label for="cr-u">Username</label><div class="copy"><input class="input" id="cr-u" readonly value="${esc(d.id)}"><button class="btn btn--secondary" data-act="copy" data-val="${esc(d.id)}">${ic("copy", 14)}Copy</button></div></div>
        <div class="field"><label for="cr-p">Password</label><div class="copy"><input class="input" id="cr-p" readonly value="${esc(CRED.secret)}"><button class="btn btn--secondary" data-act="copy" data-val="${esc(CRED.secret)}">${ic("copy", 14)}Copy</button></div><div class="msg-warn">${ic("warn", 13)}<span>It won't be shown again. Install puts it on the board for you.</span></div></div>
        <label class="row" style="gap:10px;min-height:36px"><input type="checkbox" class="check" data-act="cn-stored" data-id="${id}" ${C.stored ? "checked" : ""}> I've stored it</label></div>${next("Continue", !C.stored)}`
      : `<h2 class="sec-h" style="font-size:17px">Credential</h2><p class="sec-lead">The password was shown once, when the device was created. To install again you need a new one.</p><button class="btn btn--secondary" data-act="rotate" data-id="${id}">Rotate credential…</button>${next("Skip: the board already has it")}`;
  } else if (C.step === 1) {
    if (t.runsOn === "our") {
      const pct = C.inst?.pct ?? 0;
      body = `<h2 class="sec-h" style="font-size:17px">Install</h2><p class="sec-lead">Plug the board into this computer with a data USB cable, then install. Chrome or Edge only.</p>
        <dl class="kv" style="margin-bottom:16px"><dt>Board</dt><dd>${esc(boardName(t.board))}</dd><dt>Wiring</dt><dd>${esc(t.parts.map((p) => `${DRIVERS[p.driver].name} on ${pinsText(t, p)}`).join(" · ") || "No parts")} · <a href="#/templates/${t.id}/wiring">Wiring guide</a></dd></dl>
        ${C.inst ? `<div class="stack stack--sm" style="margin-bottom:12px"><div class="row"><span class="grow">${esc(C.inst.stage)}</span><span class="num muted">${pct} %</span></div><div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Install progress"><div style="width:${pct}%"></div></div></div>` : ""}
        ${pct === 100 ? `<div class="callout" style="margin-bottom:12px">${ic("check", 16)}<span><b>Installed.</b> The board restarts with its config and credential.</span></div>` : `<div class="row row--wrap"><button class="btn btn--primary" data-act="cn-install" data-id="${id}" ${C.inst ? "disabled" : ""}>${ic("download", 15)}Install firmware</button><button class="btn btn--secondary" data-act="cn-install" data-id="${id}" data-cfg="1" ${C.inst ? "disabled" : ""}>Update config only</button></div><p class="hint" style="margin-top:8px">A first install erases the board's saved Wi-Fi; Update config only keeps it.</p>`}
        <details class="disclosure" style="margin-top:12px"><summary>Advanced: download the sketch instead</summary><div class="disc-body"><button class="btn btn--secondary btn--sm">${ic("download", 14)}Download .ino</button></div></details>${next(pct === 100 ? "Continue" : "Skip", false)}`;
    } else {
      body = `<h2 class="sec-h" style="font-size:17px">Point your firmware at the broker</h2><p class="sec-lead">Custom firmware: publish each metric on its topic, and subscribe to commands.</p>
        <div class="code">host   ${esc(location.hostname || "iodriven.tech")}:8883 (TLS)\nuser   ${esc(d.id)}\n\npublish   ${esc(topicOf("{metric}", d.slug))}   {"value": 27.4}\nsubscribe ${esc(topicOf("cmd/+", d.slug))}\nstatus    ${esc(topicOf("status", d.slug))}   (retained, Last-Will)</div>${next()}`;
    }
  } else if (C.step === 2) {
    body = `<h2 class="sec-h" style="font-size:17px">Wi-Fi</h2><p class="sec-lead">How the board joins your network.</p>
      <div class="choices" role="radiogroup" aria-label="Wi-Fi setup" style="margin-bottom:16px">
        <button class="choice" role="radio" aria-checked="${C.wifi === "phone"}" data-act="cn-wifi" data-id="${id}" data-val="phone"><span class="radio"></span><span><b>From a phone</b><span>Scan the QR with the ESP BLE Provisioning app.</span></span></button>
        <button class="choice" role="radio" aria-checked="${C.wifi === "typed"}" data-act="cn-wifi" data-id="${id}" data-val="typed"><span class="radio"></span><span><b>Type it in</b><span>Saved on the board with its config.</span></span></button></div>
      ${C.wifi === "phone" ? `<div class="row" style="gap:16px;align-items:flex-start;flex-wrap:wrap">${qrSvg(d.id)}<ol class="small" style="margin:0;padding-left:18px;flex:1 1 200px"><li>Power the board; its LED blinks blue.</li><li>Open ESP BLE Provisioning and scan this code.</li><li>Pick your network and enter its password.</li></ol></div>` : `<div class="grid-2"><div class="field"><label for="ssid">Network name</label><input class="input" id="ssid"></div><div class="field"><label for="wpw">Password</label><input class="input" id="wpw" type="password"></div></div><p class="hint">Anyone holding the board can read it. Changing networks means running Install or Update config only again.</p>`}${next()}`;
  } else {
    const L = C.live || (C.live = { start: Date.now(), online: false, metrics: {} });
    if (!L.timer) {
      L.timer = 1;
      setTimeout(() => { L.online = true; if (S.path.endsWith("/connect")) render(); }, 3500);
      t.metrics.forEach((m, i) => setTimeout(() => { L.metrics[m.key] = true; if (S.path.endsWith("/connect")) render(); }, 5000 + i * 1200));
      setTimeout(() => S.path.endsWith("/connect") && render(), 21000);
    }
    const line = (ok, label, detail, extra = "") => `<div class="check-line">${ok ? ic("check", 16, "tone-online") : `<span class="spin" aria-hidden="true"></span>`}<span class="grow">${label}${detail ? ` <span class="muted small">${detail}</span>` : ""}</span><span class="small ${ok ? "tone-online" : "muted"}">${ok ? "OK" : "Waiting"}</span>${extra}</div>`;
    const slow = !L.online && Date.now() - L.start > 20000;
    body = `<h2 class="sec-h" style="font-size:17px">Live check</h2><p class="sec-lead">Power the board. This page updates as messages arrive.</p>
      <div>${line(L.online, "Device online", L.online ? "status received" : "")}
      ${t.metrics.map((m) => line(!!L.metrics[m.key], esc(m.name), L.metrics[m.key] ? "first reading" : "")).join("")}
      ${t.actuators.map((a) => { const s = C.acks[a.key]; return line(s === "ok", esc(a.name), s === "ok" ? "command acknowledged" : s === "busy" ? "test sent…" : "", s ? "" : `<button class="btn btn--secondary btn--sm" data-act="cn-test" data-id="${id}" data-key="${a.key}" ${L.online ? "" : "disabled"}>Send test</button>`); }).join("")}</div>
      ${slow ? `<div class="callout callout--warn" style="margin-top:16px">${ic("warn", 16)}<span><b>Nothing after 20 s.</b> Check the board has power and its LED stopped blinking, that the Wi-Fi is 2.4 GHz, and that the credential was installed. <a href="#/devices/${id}/connect" data-act="cn-restart" data-id="${id}">Start over</a></span></div>` : ""}
`;
    foot = `${back}<a class="btn btn--secondary" href="#/devices/new">Add another like this</a><a class="btn btn--primary" href="#/devices/${id}">Open device</a>`;
  }
  return `<div class="page page--editor">${ph({ crumbs: [["Devices", "#/devices"], [d.name, "#/devices/" + id]], over: `${esc(t.name)} · ${t.runsOn === "our" ? "Our firmware" : "Custom firmware"}`, title: `Connect ${esc(d.name)}` })}
    ${nav}<div class="wiz-body">${body}</div>
    <div class="savebar"><div class="state clean"><span class="dot"></span><span class="trunc">${["Store the password, then continue", "Install, or skip if it's already installed", "Wi-Fi", "Waiting for the device"][C.step]}</span></div>${foot}</div></div>`;
}
const qrSvg = (seed) => {
  let cells = "";
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
    const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
    const on = finder ? (x % 6 === 0 || y % 6 === 0 || (x > 13 && (x - 14) % 6 === 0) || (y > 13 && (y - 14) % 6 === 0) || ((x % 14 > 1 && x % 14 < 5) && (y % 14 > 1 && y % 14 < 5))) : rnd(x * 31 + y * 7 + seed.length) > 0.52;
    if (on) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }
  return `<svg width="148" height="148" viewBox="-1 -1 23 23" role="img" aria-label="Provisioning QR code" style="background:#fff;border-radius:8px;padding:6px;flex-shrink:0"><g fill="#15161a">${cells}</g></svg>`;
};
Object.assign(ACT, {
  "cn-step": (el) => { const C = S.connect[el.dataset.id]; C.step = Math.max(0, Math.min(3, C.step + +el.dataset.dir)); if (C.step > 0 && CRED?.device === el.dataset.id && C.stored) CRED = null; persistCred(); render(); $("#content")?.scrollTo(0, 0); },
  "cn-stored": (el) => { S.connect[el.dataset.id].stored = el.checked; render(); },
  "cn-wifi": (el) => { S.connect[el.dataset.id].wifi = el.dataset.val; render(); },
  "cn-restart": (el) => { S.connect[el.dataset.id].live = null; render(); },
  "cn-install": (el) => {
    const C = S.connect[el.dataset.id];
    const stages = el.dataset.cfg ? [["Connecting to the board", 20], ["Writing config", 70], ["Verifying", 100]] : [["Connecting to the board", 8], ["Erasing", 20], ["Writing firmware", 45], ["Writing firmware", 70], ["Writing config", 88], ["Verifying", 100]];
    let i = 0;
    const step = () => { C.inst = { stage: stages[i][0], pct: stages[i][1] }; render(); if (++i < stages.length) setTimeout(step, 700); };
    step();
  },
  "cn-test": (el) => {
    const C = S.connect[el.dataset.id];
    const key = el.dataset.key;
    C.acks[key] = "busy";
    render();
    // The ack is matched to its own actuator (fixes the audit's first-busy bug).
    setTimeout(() => { C.acks[key] = "ok"; render(); }, 1300);
  },
});

/* ---------- Templates ---------- */
function tplPeek(t) {
  const n = DEVICES.filter((d) => d.tpl === t.id).length;
  return `<div class="stack"><div class="row">${t.enabled ? badge(["Enabled", "online", ""]) : badge(["Disabled", "unknown", "sq"])}<span class="muted small">· ${plural(n, "device")}</span></div>
    <dl class="kv"><dt>Runs on</dt><dd>${t.runsOn === "our" ? "Our firmware" : "Custom firmware"}</dd>${t.runsOn === "our" ? `<dt>Board</dt><dd>${esc(boardName(t.board))}</dd><dt>Parts</dt><dd>${esc(t.parts.map((p) => DRIVERS[p.driver].name).join(", ") || "None")}</dd>` : ""}</dl>
    <div><h3 class="field-label" style="margin-bottom:8px">What you'll see</h3>${whatYoullSee(t)}</div></div>`;
}
function pageTemplates() {
  const L = listState("templates", {});
  const q = L.q.toLowerCase();
  const rows = TEMPLATES.filter((t) => !q || t.name.toLowerCase().includes(q)).sort(cmpBy(L, (t, k) => (k === "devices" ? DEVICES.filter((d) => d.tpl === t.id).length : k === "metrics" ? t.metrics.length : t.name.toLowerCase())));
  const head = ph({ title: "Device templates", desc: "What a kind of device publishes and what it can switch. Devices are added from these.", actions: `<a class="btn btn--primary" href="#/templates/new">${ic("plus", 15)}New template</a>` });
  const table = `<div class="toolbar">${searchBox("templates", "Search templates")}<span class="result-count">${rows.length} of ${TEMPLATES.length}</span></div>
    <div class="tbl-wrap"><table class="tbl no-check"><thead><tr>${sortTh("templates", "name", "Template")}${sortTh("templates", "metrics", "Metrics", "r col-p2")}<th class="r col-p3">Actuators</th>${sortTh("templates", "devices", "Devices", "r")}<th>Status</th><th class="w-menu"><span class="sr-only">Actions</span></th></tr></thead><tbody>
    ${rows.map((t) => { const n = DEVICES.filter((d) => d.tpl === t.id).length; return `<tr data-act="peek" data-kind="template" data-peek="${t.id}" tabindex="0" class="${t.enabled ? "" : "is-disabled"}" aria-selected="${S.peek?.id === t.id}"><td><div class="cell-name"><a href="#/templates/${t.id}">${esc(t.name)}</a><span class="sub">${t.runsOn === "our" ? `Our firmware · ${esc(boardName(t.board))}` : "Custom firmware"}<span class="fold fold-p2"> · ${plural(t.metrics.length, "metric")}</span></span></div></td><td class="r num col-p2 c-extra">${t.metrics.length}</td><td class="r num col-p3 c-extra">${t.actuators.length}</td><td class="r num c-seen">${plural(n, "device")}</td><td class="c-status">${t.enabled ? badge(["Enabled", "online", ""]) : badge(["Disabled", "unknown", "sq"])}</td><td class="w-menu">${menuBtn("tpl", `Actions for ${t.name}`, `data-id="${t.id}"`)}</td></tr>`; }).join("")}
    </tbody></table>${tblFoot(rows.length, TEMPLATES.length, "templates")}</div>`;
  return DEMO.listLayout ? DEMO.listLayout("template", head, table) : `<div class="page">${head}${table}</div>`;
}
function pageWiringGuide(id) {
  const t = tplById(id);
  const rows = [];
  for (const p of t.parts) {
    const dr = DRIVERS[p.driver];
    if (dr.i2c) rows.push([dr.name, "SDA", pinName(I2C_DEFAULT[t.board][0])], [dr.name, "SCL", pinName(I2C_DEFAULT[t.board][1])], [dr.name, "VCC / GND", "3V3 / GND"]);
    else for (const r of dr.pins) rows.push([dr.name, r.label, pinName(p.pins[r.role])]);
  }
  return `<div class="page">${ph({ crumbs: [["Device templates", "#/templates"], [t.name, "#/templates/" + id]], over: esc(boardName(t.board)), title: "Wiring guide", desc: "Print it or keep it open while you wire the board.", actions: `<button class="btn btn--secondary" onclick="window.print()">${ic("printer", 15)}Print</button>` })}
    <div class="tbl-wrap"><table class="tbl no-check"><thead><tr><th>Part</th><th>Connection</th><th>Board pin</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="mono">${esc(r[2])}</td></tr>`).join("")}</tbody></table></div>
    <h2 class="sec-h" style="margin:28px 0 8px;font-size:16px">Notes</h2><ul class="muted" style="padding-left:18px;margin:0">${t.parts.map((p) => `<li>${esc(DRIVERS[p.driver].name)}: ${DRIVERS[p.driver].i2c ? `shares the I2C bus, address ${DRIVERS[p.driver].address}.` : DRIVERS[p.driver].kind === "outputs" ? "use a relay module with its own supply for mains loads." : "power it from 3V3."}</li>`).join("")}<li>Provisioning reset: hold GPIO ${t.board === "c3-mini" ? 9 : 19} low at boot.</li></ul></div>`;
}

/* ---------- Dashboards ---------- */
function pageDashboards() {
  return `<div class="page">${ph({ title: "Dashboards", desc: "Your own dashboards. Each member builds theirs.", actions: `<a class="btn btn--primary" href="#/dashboards/db1">${ic("plus", 15)}New dashboard</a>` })}
    <div class="tbl-wrap"><table class="tbl no-check"><thead><tr><th>Dashboard</th><th class="r">Widgets</th><th class="r col-p2">Updated</th></tr></thead><tbody>${DASHBOARDS.map((db, i) => `<tr data-act="nav" data-href="#/dashboards/${db.id}" tabindex="0"><td><div class="cell-name"><a href="#/dashboards/${db.id}">${esc(db.name)}</a></div></td><td class="r num c-seen">${plural(db.widgets.length, "widget")}</td><td class="r col-p2 c-extra">${absTime(NOW - (i + 1) * 9 * HOUR)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function widgetHtml(db, w) {
  const d = devById(w.device);
  const m = w.metric && metricOf(d, w.metric);
  const title = wTitle(w);
  const r = READINGS[d.id]?.[w.metric];
  const [f] = m ? freshness(d, m, r) : ["Live"];
  let body = "";
  if (w.type === "value") body = `<div class="r-v num ${f === "Stale" ? "is-stale" : ""}" style="font-size:30px;font-weight:600" data-readout="${f === "Live" ? d.id + ":" + w.metric : ""}">${r && r[0] != null ? fmtReading(m, r[0]) : "—"}${unitOf(m) ? `<small class="muted" style="font-size:15px;margin-left:4px">${esc(m.unit)}</small>` : ""}</div><div class="small muted">${f === "Stale" ? `Stale · last value ${agoEl(r?.[1])}` : f === "No data" ? "No data" : agoEl(r?.[1])}</div>`;
  else if (w.type === "status") body = `<div class="stack stack--sm">${devBadge(d.status)}<div class="small muted">Last message ${agoEl(d.seen)}${d.rssi ? ` · ${d.rssi} dBm` : ""}</div></div>`;
  else if (w.type === "actuator") { const st = ACTUATORS[d.id]?.[w.actuator] || {}; body = `<div class="row row--wrap"><span class="grow small">${st.pending ? '<span class="tone-pending">Waiting for confirmation</span>' : `Reports <b>${st.reported == null ? "unknown" : fmtVal(st.reported)}</b>`}</span><div class="seg" role="group" aria-label="Set">${[[true, "On"], [false, "Off"]].map(([v, l]) => `<button aria-pressed="${st.requested === v}" data-act="cmd" data-dev="${d.id}" data-act-key="${w.actuator}" data-val="${v}">${l}</button>`).join("")}</div></div>`; }
  else if (w.type === "gauge") { const v = r?.[0] ?? 0; const lo = m?.min ?? 0, hi = m?.max ?? 100; const a = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); const ang = Math.PI * (1 - a); body = `<svg viewBox="0 0 120 70" width="100%" style="max-width:220px;display:block;margin:0 auto" role="img" aria-label="${esc(m?.name)} ${fmtReading(m, v)} ${esc(unitOf(m))} of ${hi}"><path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="var(--color-border)" stroke-width="9" stroke-linecap="round"/><path d="M10 60 A50 50 0 0 1 ${60 + 50 * Math.cos(ang)} ${60 - 50 * Math.sin(ang)}" fill="none" stroke="var(--color-chart)" stroke-width="9" stroke-linecap="round"/></svg><div class="gauge-v" style="text-align:center;margin-top:-14px">${fmtReading(m, v)}<small class="muted" style="font-size:14px"> ${esc(unitOf(m))}</small></div><div class="small muted" style="text-align:center">${lo}–${hi} ${esc(unitOf(m))}</div>`; }
  else if (w.type === "trend") { const rule = { threshold: thresholdFor(d.id, w.metric) }; body = chartHtml(`w-${db.id}-${w.id}`, { dev: d.id, key: w.metric, range: S.range, bool: m?.type === "bool", threshold: rule?.threshold, unit: m?.unit, until: d.status === "online" ? undefined : d.seen, label: `${m?.name} over the last ${S.range}`, h: 170 }); }
  const i = db.widgets.indexOf(w);
  const edit = `<div class="widget-edit"><button class="btn btn--icon btn--sm" data-act="w-move" data-db="${db.id}" data-w="${w.id}" data-dir="-1" aria-label="Move ${esc(title)} earlier" ${i === 0 ? "disabled" : ""}>${ic("chevL", 14)}</button><button class="btn btn--icon btn--sm" data-act="w-move" data-db="${db.id}" data-w="${w.id}" data-dir="1" aria-label="Move ${esc(title)} later" ${i === db.widgets.length - 1 ? "disabled" : ""}>${ic("chevR", 14)}</button><button class="btn btn--icon btn--sm" data-act="w-open" data-db="${db.id}" data-w="${w.id}" aria-label="Edit ${esc(title)}">${ic("edit", 14)}</button><button class="btn btn--icon btn--sm" data-act="w-remove" data-db="${db.id}" data-w="${w.id}" aria-label="Remove ${esc(title)}">${ic("trash", 14)}</button></div>`;
  const editing = dashEditing();
  return `<section class="widget ${editing ? "is-editable" : ""}" style="--span:${w.span}" aria-label="${esc(title)}" ${editing ? `data-act="w-open" data-db="${db.id}" data-w="${w.id}" tabindex="0" role="button"` : ""}><div class="widget-h"><b class="trunc">${esc(title)}</b>${edit}</div>${body}</section>`;
}
const dashEditing = () => S.dashEdit || S.q.get("edit") === "1";
function pageDashboard(id) {
  const db = DASHBOARDS.find((x) => x.id === id) || DASHBOARDS[0];
  const sw = `<select class="select" style="width:auto;font-weight:600" data-nav aria-label="Dashboard">${DASHBOARDS.map((x) => `<option value="#/dashboards/${x.id}" ${x.id === db.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`;
  const editing = dashEditing();
  const typeName = (t) => W_TYPES.find((x) => x[0] === t)?.[1];
  const sizeName = (s) => W_SIZES.find((x) => x[0] === s)?.[1] || s;
  const wlist = `<div class="wlist lines" aria-label="Widgets, in order">${db.widgets.map((w, i) => `<div class="line"><span class="l-main"><b>${esc(wTitle(w))}</b><span>${typeName(w.type)} · ${sizeName(w.span)}</span></span><button class="btn btn--icon" data-act="w-move" data-db="${db.id}" data-w="${w.id}" data-dir="-1" aria-label="Move ${esc(wTitle(w))} up" ${i === 0 ? "disabled" : ""}>${ic("chevU", 16)}</button><button class="btn btn--icon" data-act="w-move" data-db="${db.id}" data-w="${w.id}" data-dir="1" aria-label="Move ${esc(wTitle(w))} down" ${i === db.widgets.length - 1 ? "disabled" : ""}>${ic("chevD", 16)}</button><button class="btn btn--secondary btn--sm" data-act="w-open" data-db="${db.id}" data-w="${w.id}">Edit</button></div>`).join("")}<div class="line"><button class="btn btn--secondary" style="width:100%" data-act="w-add" data-db="${db.id}">${ic("plus", 15)}Add widget</button></div></div>`;
  return `<div class="page page--wide ${editing ? "editing" : ""}">${ph({ crumbs: [["Dashboards", "#/dashboards"]], title: esc(db.name), desc: `${plural(db.widgets.length, "widget")} · live`, actions: `${sw}${rangeSeg(S.range)}${editing ? `<button class="btn btn--secondary" data-act="w-add" data-db="${db.id}">${ic("plus", 15)}Add widget</button><button class="btn btn--primary" data-act="dash-done">Done</button>` : `<button class="btn btn--secondary" data-act="dash-edit">${ic("edit", 14)}Edit layout</button>`}` })}
    ${editing ? `<div class="callout" style="margin-bottom:14px">${ic("info", 16)}<span>Click a widget to change what it shows and its size; move it with its arrows. Changes save as you go.</span></div>${wlist}` : ""}
    <div class="dgrid">${db.widgets.map((w) => widgetHtml(db, w)).join("")}</div></div>`;
}

/* ---------- Zones, members, keys, settings ---------- */
function pageZones() {
  return `<div class="page">${ph({ title: "Zones", desc: "Places your devices live in.", actions: `<a class="btn btn--primary" href="#/zones/new">${ic("plus", 15)}New zone</a>` })}
    <div class="tbl-wrap"><table class="tbl no-check"><thead><tr><th>Zone</th><th class="r">Devices</th><th>Status</th></tr></thead><tbody>${ZONES.map((z) => { const n = DEVICES.filter((d) => d.zone === z.id); const off = n.filter((d) => d.status === "offline").length; return `<tr data-act="nav" data-href="#/zones/${z.id}" tabindex="0"><td><div class="cell-name"><a href="#/zones/${z.id}">${esc(z.name)}</a><span class="sub">${esc(z.notes) || "No notes"}</span></div></td><td class="r num c-seen">${plural(n.length, "device")}</td><td class="c-status">${off ? badge([`${off} offline`, "offline", ""]) : badge(["All reporting", "online", ""])}</td></tr>`; }).join("")}</tbody></table></div></div>`;
}
function pageZone(id) {
  const z = ZONES.find((x) => x.id === id);
  useEditor("zone:" + id, () => ({ name: z?.name || "", notes: z?.notes || "" }), {
    isNew: !z, noun: z ? z.name : "the new zone",
    validate: (x) => ({ E: x.name.trim() ? (ZONES.some((o) => o !== z && o.name === x.name.trim()) ? { name: "Another zone has this name." } : {}) : { name: "Name the zone." }, W: {} }),
    onSave: (x) => {
      if (z) { Object.assign(z, x); ED.orig = clone(x); toast({ title: "Zone saved" }); render(); }
      else { const nz = { id: uid("z"), ...x }; ZONES.push(nz); ED.leaving = true; toast({ title: "Zone created" }); navigate("#/zones/" + nz.id); }
    },
  });
  const n = z ? DEVICES.filter((d) => d.zone === z.id).length : 0;
  const spec = {
    consequence: z ? `${plural(n, "device")} in it. Devices are moved from their own settings.` : "Devices are added to a zone from their own settings.",
    sections: [{ id: "general", title: "Zone", body: `<div class="stack">${fld({ path: "name", label: "Name" })}${fld({ path: "notes", label: "Notes", optional: true, type: "textarea" })}</div>` }],
    saveLabel: z ? "Save" : "Create zone",
  };
  return `<div class="page page--editor">${ph({ crumbs: [["Zones", "#/zones"]], over: "Zone", title: esc(ED.draft.name || (z ? z.name : "New zone")), desc: spec.consequence, actions: z ? menuBtn("zone", "More actions", `data-id="${id}"`) : "" })}${DEMO.frame(spec)}</div>`;
}
MENUS.zone = (el) => [{ label: "View devices", href: "#/devices" }, "-", { label: "Delete…", act: "zone-delete", attrs: `data-id="${el.dataset.id}"`, danger: true, hint: (() => { const n = DEVICES.filter((d) => d.zone === el.dataset.id).length; return n ? plural(n, "device is", "devices are") + " in it" : ""; })() }];
ACT["zone-delete"] = async (el) => {
  const z = ZONES.find((x) => x.id === el.dataset.id);
  const n = DEVICES.filter((d) => d.zone === z.id).length;
  if (n) { await confirmDlg({ title: `${esc(z.name)} isn't empty`, body: `${plural(n, "device is", "devices are")} in it. Move them to another zone from their settings first.`, confirm: "OK", danger: false, cancel: "Close" }); return; }
};
function pageMembers() {
  return `<div class="page">${ph({ title: "Members", desc: "People in this workspace and what they can do.", actions: `<a class="btn btn--primary" href="#/members/invite">${ic("plus", 15)}Invite</a>` })}
    <div class="tbl-wrap"><table class="tbl no-check"><thead><tr><th>Name</th><th>Role</th><th class="r col-p2">Last active</th></tr></thead><tbody>${MEMBERS.map((u) => `<tr><td><div class="cell-name"><b>${esc(u.name)}</b><span class="sub">${esc(u.email)}</span></div></td><td class="c-status">${u.role === "Owner" ? "Owner" : `<select class="select" style="width:auto;height:30px" aria-label="Role for ${esc(u.name)}"><option ${u.role === "Admin" ? "selected" : ""}>Admin</option><option ${u.role === "Viewer" ? "selected" : ""}>Viewer</option></select>`}</td><td class="r col-p2 c-extra">${agoEl(u.active)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function pageInvite() {
  useEditor("invite", () => ({ email: "", role: "Viewer" }), {
    isNew: true, noun: "the invite",
    validate: (x) => ({ E: /^\S+@\S+\.\S+$/.test(x.email) ? {} : { email: "Enter an email address." }, W: {} }),
    onSave: (x) => { ED.leaving = true; toast({ title: "Invite sent", detail: `${esc(x.email)} has 7 days to accept.` }); navigate("#/members"); },
  });
  return `<div class="page page--editor">${ph({ crumbs: [["Members", "#/members"]], title: "Invite a member", desc: "They get an email with a link that works for 7 days." })}${DEMO.frame({ sections: [{ id: "who", title: "Who", body: `<div class="grid-2">${fld({ path: "email", label: "Email", type: "email" })}<div class="field"><span class="field-label">Role</span>${seg("role", [["Viewer", "Viewer"], ["Admin", "Admin"]], undefined, "Role")}<div class="hint">${ED.draft.role === "Admin" ? "Can change devices, rules and members (not owners)." : "Can see everything, change nothing."}</div></div></div>` }], saveLabel: "Send invite" })}</div>`;
}
function pageKeys() {
  return `<div class="page">${ph({ title: "API keys", desc: "For scripts and other systems: Authorization: Bearer.", actions: `<a class="btn btn--primary" href="#/keys/new">${ic("plus", 15)}New key</a>` })}
    <div class="tbl-wrap"><table class="tbl no-check"><thead><tr><th>Name</th><th>Scope</th><th class="r col-p2">Last used</th><th class="r col-p3">Expires</th></tr></thead><tbody>${KEYS.map((k) => `<tr><td><div class="cell-name"><b>${esc(k.name)}</b><span class="sub">Created ${absTime(k.created)}</span></div></td><td class="c-status">${k.expires && k.expires < NOW ? badge(["Expired", "unknown", "sq"]) : esc(k.scope)}</td><td class="r col-p2 c-extra">${agoEl(k.used)}</td><td class="r col-p3 c-extra">${k.expires ? absTime(k.expires) : "Never"}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function pageKeyNew() {
  useEditor("key", () => ({ name: "", scope: "Viewer", expires: "90" }), {
    isNew: true, noun: "the new key",
    validate: (x) => ({ E: x.name.trim() ? {} : { name: "Name the key." }, W: x.scope === "Admin" ? { scope: "" } : {} }),
    onSave: async (x) => {
      KEYS.unshift({ id: uid("k"), name: x.name, scope: x.scope, created: Date.now(), used: null, expires: x.expires === "never" ? null : Date.now() + +x.expires * DAY });
      const secret = "iod_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      ED.leaving = true;
      await confirmDlg({ title: "Copy your key", body: "It won't be shown again.", details: `<div class="copy" style="margin-top:12px"><input class="input" readonly value="${secret}" aria-label="API key"><button class="btn btn--secondary" data-act="copy" data-val="${secret}">${ic("copy", 14)}Copy</button></div>`, confirm: "I've stored it", danger: false, cancel: "Close" });
      navigate("#/keys");
    },
  });
  return `<div class="page page--editor">${ph({ crumbs: [["API keys", "#/keys"]], title: "New API key" })}${DEMO.frame({ consequence: "The key is shown once, then stored hashed.", sections: [{ id: "key", title: "Key", body: `<div class="grid-2">${fld({ path: "name", label: "Name", hint: "What uses it, e.g. Grafana." })}${fld({ path: "expires", label: "Expires", type: "select", options: [{ v: "30", l: "In 30 days" }, { v: "90", l: "In 90 days" }, { v: "365", l: "In a year" }, { v: "never", l: "Never" }] })}</div><div class="field" style="margin-top:16px"><span class="field-label">Scope</span>${seg("scope", [["Viewer", "Viewer"], ["Admin", "Admin"]], undefined, "Scope")}<div class="hint">${ED.draft.scope === "Admin" ? "Can change devices and rules. Give it only to systems you trust." : "Read-only."}</div></div>` }], saveLabel: "Create key" })}</div>`;
}
function pageSettings() {
  useEditor("settings", () => ({ name: WORKSPACE.name, recipients: WORKSPACE.recipients.join(", "), tz: WORKSPACE.tz, you: WORKSPACE.user }), {
    noun: "workspace settings",
    validate: (x) => ({ E: x.name.trim() ? {} : { name: "Name the workspace." }, W: {} }),
    onSave: (x, before) => {
      const L = [];
      if (x.name !== before.name) L.push(`Name: ${before.name} → ${x.name}`);
      if (x.tz !== before.tz) L.push(`Time zone: ${before.tz} → ${x.tz}`);
      if (x.recipients !== before.recipients) L.push("Alert recipients changed");
      WORKSPACE.name = x.name; WORKSPACE.tz = x.tz; WORKSPACE.user = x.you;
      ED.orig = clone(x);
      toast({ title: "Settings saved", detail: changeSummary(L) });
      render();
    },
  });
  const zones = ["UTC", "Europe/Madrid", "Europe/London", "America/Mexico_City", "America/Bogota", "America/New_York", "America/Los_Angeles", WORKSPACE.tz].filter((v, i, a) => a.indexOf(v) === i);
  return `<div class="page page--editor">${ph({ title: "Workspace settings" })}${DEMO.frame({
    consequence: "Applies to everyone in IO Driven.",
    sections: [
      { id: "ws", title: "Workspace", body: fld({ path: "name", label: "Name" }) },
      { id: "alerts", title: "Alerts", lead: "Who rule emails and critical notifications go to.", body: fld({ path: "recipients", label: "Recipients", hint: "Separated by commas." }) },
      { id: "time", title: "Time and region", body: fld({ path: "tz", label: "Time zone", type: "select", options: zones.map((z) => ({ v: z, l: z })), hint: "Used for schedules, charts and every time shown in the app. Times are 24-hour." }) },
      { id: "you", title: "You", body: fld({ path: "you", label: "Your name" }) },
      { id: "leave", title: "Leave workspace", danger: true, body: `<div class="row row--wrap"><p class="grow small muted">You're the only owner, so you can't leave until someone else is an owner.</p><button class="btn btn--secondary" disabled>Leave workspace…</button></div>` },
    ],
    saveLabel: "Save",
  })}</div>`;
}
function pageLogin() {
  return `<div class="auth"><div class="auth-card"><div class="row" style="justify-content:center;margin-bottom:20px"><span class="ws-logo">I</span><b style="font-size:17px">IO Driven</b></div>
    <div class="card card-pad"><h1 style="font-size:22px;font-weight:600;margin-bottom:4px">Sign in</h1><p class="muted small" style="margin-bottom:18px">to your workspace</p>
    <form class="stack" onsubmit="return false"><div class="field"><label for="em">Email</label><input class="input" id="em" type="email" autocomplete="email" value="owner@iodriven.tech"></div><div class="field"><label for="pw" class="row" style="justify-content:space-between">Password <a href="#/login" class="small">Forgot it?</a></label><input class="input" id="pw" type="password" autocomplete="current-password" value="••••••••••"></div>
    <label class="row" style="min-height:36px"><input type="checkbox" class="check"> Keep me signed in on this device</label>
    <button class="btn btn--primary" data-act="login" style="width:100%">Sign in</button></form></div>
    <p class="small muted" style="text-align:center;margin-top:14px">No account? <a href="#/login">Create a workspace</a></p></div></div>`;
}

/* ---------- Add device: "From a template" fields (shared) ---------- */
function fromTemplateEditor() {
  return useEditor("add:tpl", () => ({ name: "", tpl: TEMPLATES.find((t) => t.enabled && t.id !== "t-legacy")?.id || "", zone: "" }), {
    isNew: true, noun: "the new device",
    validate: (x) => ({ E: { ...(x.name.trim() ? {} : { name: "Name the device." }), ...(x.tpl ? {} : { tpl: "Pick a template." }) }, W: {} }),
    onSave: (x) => { const dev = createDevice({ name: x.name.trim(), tplId: x.tpl, zone: x.zone }); ED.leaving = true; toast({ title: `${dev.name} created`, detail: "Next: its credential and Install." }); navigate(`#/devices/${dev.id}/connect`); },
  });
}
function fromTemplateFields() {
  const x = ED.draft;
  const t = tplById(x.tpl);
  return `<div class="stack">
    <div class="grid-2">${fld({ path: "name", label: "Device name", hint: "Shown in lists and alerts. Its MQTT id is made from it." })}${fld({ path: "zone", label: "Zone", optional: true, type: "select", options: [{ v: "", l: "No zone" }, ...ZONES.map((z) => ({ v: z.id, l: z.name }))] })}</div>
    ${fld({ path: "tpl", label: "Template", type: "select", options: TEMPLATES.filter((t) => t.enabled).map((t) => ({ v: t.id, l: t.name, g: t.runsOn === "our" ? "Our firmware" : "Custom firmware" })) })}
    ${t ? `<div class="card card-pad" style="box-shadow:none;background:var(--color-surface-raised);border:0"><div class="field-label" style="margin-bottom:8px">It gives you</div>${whatYoullSee(t)}</div>` : ""}
  </div>`;
}
const startChoice = (cur) => `<div class="choices" role="radiogroup" aria-label="How to start">
  <button class="choice" role="radio" aria-checked="${cur === "tpl"}" data-act="start" data-val="tpl"><span class="radio"></span><span><b>From a template</b><span>Another device like one you already have.</span></span></button>
  <button class="choice" role="radio" aria-checked="${cur === "new"}" data-act="start" data-val="new"><span class="radio"></span><span><b>Something new</b><span>Say what it runs on and what it has; we make its template.</span></span></button></div>`;
const defaultStart = () => (S.addStart ||= TEMPLATES.some((t) => t.enabled && t.id !== "t-legacy") ? "tpl" : "new");

/* ---------- Routes ---------- */
const CORE_ROUTES = [
  [/^\/login$/, pageLogin, { bare: true }],
  [/^\/dashboards$/, pageDashboards],
  [/^\/dashboards\/(\w+)$/, pageDashboard],
  [/^\/devices$/, pageDevices],
  [/^\/devices\/new$/, () => DEMO.addDevice()],
  [/^\/devices\/(\w+)\/connect$/, pageConnect],
  [/^\/devices\/(\w+)$/, pageDevice],
  [/^\/templates$/, pageTemplates],
  [/^\/templates\/new$/, () => DEMO.templateEditor(null)],
  [/^\/templates\/([\w-]+)\/wiring$/, pageWiringGuide],
  [/^\/templates\/([\w-]+)$/, (id) => DEMO.templateEditor(id)],
  [/^\/rules$/, pageRules],
  [/^\/rules\/new$/, pageRuleNew],
  [/^\/rules\/new\/edit$/, pageRuleWizard],
  [/^\/rules\/(\w+)$/, pageRule],
  [/^\/notifications$/, pageNotifications],
  [/^\/zones$/, pageZones],
  [/^\/zones\/(\w+)$/, pageZone],
  [/^\/members$/, pageMembers],
  [/^\/members\/invite$/, pageInvite],
  [/^\/keys$/, pageKeys],
  [/^\/keys\/new$/, pageKeyNew],
  [/^\/settings$/, pageSettings],
];
const NAV = [
  ["Monitor", [["Dashboards", "#/dashboards", "grid", () => DASHBOARDS.length], ["Devices", "#/devices", "cpu", () => DEVICES.length], ["Notifications", "#/notifications", "bell", () => -unackedAlarms()]]],
  ["Automate", [["Rules", "#/rules", "rules", () => RULES.length]]],
  ["Configure", [["Device templates", "#/templates", "layers", () => TEMPLATES.length], ["Zones", "#/zones", "pin", () => ZONES.length]]],
  ["Admin", [["Members", "#/members", "users", () => MEMBERS.length], ["API keys", "#/keys", "key", () => KEYS.length], ["Workspace settings", "#/settings", "sliders", () => null]]],
];
const isCurrent = (href) => S.path === href.slice(1) || S.path.startsWith(href.slice(1) + "/");
const navCount = (n) => (n == null ? "" : n < 0 ? `<span class="alert-count" aria-label="${-n} unread">${-n}</span>` : `<span class="count">${n}</span>`);
