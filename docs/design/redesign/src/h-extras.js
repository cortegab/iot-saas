/* h-extras.js — Notifications as an alarm inbox, dashboard edit (widget sheet
   and add-widget steps), and the command time-limit sweep. */

/* ---------- Alarms ---------- */
const unackedAlarms = () => ALARMS.filter((a) => a.state === "active").length;
const ALARM_ST = { active: ["Active", "offline", ""], acknowledged: ["Acknowledged", "pending", "ring"], cleared: ["Cleared", "unknown", "sq"] };
S.aSel = new Set();
function alarmRow(a, selectable) {
  const [sl, tone, icn] = SEV_TONE[a.sev];
  const d = devById(a.device), r = a.rule && ruleById(a.rule);
  return `<div class="line alarm ${a.state === "active" ? "is-active" : ""}" data-act="al-open" data-id="${a.id}" tabindex="0" role="button" aria-label="${esc(a.title)}, ${ALARM_ST[a.state][0]}">
    ${selectable ? `<input type="checkbox" class="check" aria-label="Select ${esc(a.title)}" data-act="al-sel" data-id="${a.id}" ${S.aSel.has(a.id) ? "checked" : ""}>` : ""}
    <span class="tone-${tone} al-sev">${ic(icn, 17)}<span class="sr-only">${sl}</span></span>
    <span class="l-main"><b>${esc(a.title)}${a.count > 1 ? ` <span class="tag">×${a.count}</span>` : ""}</b><span style="white-space:normal">${esc(a.detail)}</span>
      <span class="small">${sl} · ${d ? `<a href="#/devices/${d.id}">${esc(d.name)}</a>` : ""}${r ? ` · <a href="#/rules/${r.id}">${esc(r.draft.name)}</a>` : ""} · ${a.count > 1 ? `since ${absTime(a.first)}, last ${agoEl(a.last)}` : agoEl(a.last)}</span>
      ${a.state === "acknowledged" ? `<span class="small">Acknowledged by <b>${esc(a.ackBy)}</b> ${agoEl(a.ackAt)}${a.ackNote ? `: “${esc(a.ackNote)}”` : ""}</span>` : ""}</span>
    <span class="l-end">${badge(ALARM_ST[a.state])}${a.state === "active" ? `<button class="btn btn--secondary btn--sm" data-act="al-ack" data-ids="${a.id}">Acknowledge…</button>` : ""}</span></div>`;
}
function pageNotifications() {
  const L = listState("alarms", { sev: "", dev: "", rule: "" });
  const tab = ["active", "acknowledged", "cleared", "all"].includes(S.q.get("tab")) ? S.q.get("tab") : "active";
  const q = L.q.toLowerCase();
  const rows = ALARMS.filter((a) => (tab === "all" || a.state === tab) && (!L.sev || a.sev === L.sev) && (!L.dev || a.device === L.dev) && (!L.rule || a.rule === L.rule) && (!q || (a.title + a.detail).toLowerCase().includes(q))).sort((a, b) => (a.state === "active") - (b.state === "active") || SEV.indexOf(a.sev) - SEV.indexOf(b.sev) || b.last - a.last).sort((a, b) => (b.state === "active") - (a.state === "active"));
  const count = (st) => ALARMS.filter((a) => a.state === st).length;
  const active = ALARMS.filter((a) => a.state === "active");
  const kpi = (label, n, tone, onAct) => `<button class="kpi" ${onAct}><span class="k-l">${badge([label, tone, ""])}</span><span class="k-v">${n}</span></button>`;
  const selIds = [...S.aSel].filter((id) => ALARMS.find((a) => a.id === id)?.state === "active");
  return `<div class="page">${ph({ title: "Notifications", desc: "Alarms that need someone, and what happened. Acknowledge one to say you're on it; it clears by itself when its condition is false again." })}
    <div class="kpis kpis--3" role="group" aria-label="Active alarms">${kpi("Critical, active", active.filter((a) => a.sev === "critical").length, "offline", `data-act="filter" data-list="alarms" data-key="sev" data-val="${L.sev === "critical" ? "" : "critical"}" aria-pressed="${L.sev === "critical"}"`)}${kpi("Warnings, active", active.filter((a) => a.sev === "warning").length, "pending", `data-act="filter" data-list="alarms" data-key="sev" data-val="${L.sev === "warning" ? "" : "warning"}" aria-pressed="${L.sev === "warning"}"`)}${kpi("Not acknowledged", active.length, "accent", `data-act="al-tab" data-val="active" aria-pressed="false"`)}</div>
    <div class="tabs" role="tablist" aria-label="Alarm state">${[["active", "Active", count("active")], ["acknowledged", "Acknowledged", count("acknowledged")], ["cleared", "Cleared", count("cleared")], ["all", "All", ALARMS.length]].map(([v, l, n]) => `<button role="tab" id="at-${v}" aria-selected="${tab === v}" tabindex="${tab === v ? 0 : -1}" data-act="al-tab" data-val="${v}">${l} <span class="count" style="margin-left:2px">${n}</span></button>`).join("")}</div>
    <div class="toolbar">${searchBox("alarms", "Search alarms")}
      <select class="select" data-list="alarms" data-key="sev" aria-label="Severity"><option value="">All severities</option>${SEV.map((s) => `<option value="${s}" ${L.sev === s ? "selected" : ""}>${SEV_TONE[s][0]}</option>`).join("")}</select>
      <select class="select" data-list="alarms" data-key="dev" aria-label="Device"><option value="">All devices</option>${[...new Set(ALARMS.map((a) => a.device))].map((id) => `<option value="${id}" ${L.dev === id ? "selected" : ""}>${esc(devById(id)?.name)}</option>`).join("")}</select>
      <select class="select" data-list="alarms" data-key="rule" aria-label="Rule"><option value="">All rules</option>${RULES.filter((r) => ALARMS.some((a) => a.rule === r.id)).map((r) => `<option value="${r.id}" ${L.rule === r.id ? "selected" : ""}>${esc(r.draft.name)}</option>`).join("")}</select>
      <button class="btn btn--secondary filters-btn" data-act="filters-sheet" data-list="alarms">${ic("filter", 14)}Filters</button>
      <span class="result-count">${rows.length} shown</span></div>
    ${chipsFor("alarms", [["sev", "Severity", (v) => SEV_TONE[v][0]], ["dev", "Device", (v) => devById(v)?.name], ["rule", "Rule", (v) => ruleById(v)?.draft.name]])}
    ${selIds.length ? `<div class="bulkbar" role="region" aria-label="Bulk actions"><b>${selIds.length} selected</b><button class="btn btn--secondary btn--sm" data-act="al-ack" data-ids="${selIds.join(",")}">Acknowledge…</button><button class="btn btn--link small" data-act="al-sel-clear">Clear selection</button></div>` : ""}
    ${rows.length ? `<div class="lines">${rows.map((a) => alarmRow(a, a.state === "active")).join("")}</div>` : `<div class="card"><div class="empty"><b>${tab === "active" ? "Nothing needs attention" : "Nothing here"}</b>${tab === "active" ? "No active alarms. New ones appear here and in the bell." : "No alarms match."}</div></div>`}</div>`;
}
function openAlarm(id) {
  const a = ALARMS.find((x) => x.id === id);
  const d = devById(a.device), r = a.rule && ruleById(a.rule);
  openSheet({
    title: esc(a.title), sub: `${SEV_TONE[a.sev][0]} · ${ALARM_ST[a.state][0]}`,
    body: `<div class="stack"><p>${esc(a.detail)}</p>
      <dl class="kv"><dt>Device</dt><dd>${d ? `<a href="#/devices/${d.id}">${esc(d.name)}</a>` : "—"}</dd><dt>Rule</dt><dd>${r ? `<a href="#/rules/${r.id}">${esc(r.draft.name)}</a>` : "—"}</dd><dt>First</dt><dd>${absTime(a.first)}</dd><dt>Last</dt><dd>${absTime(a.last)}${a.count > 1 ? ` · ${a.count} times` : ""}</dd>${a.ackBy ? `<dt>Acknowledged</dt><dd>${esc(a.ackBy)}, ${absTime(a.ackAt)}${a.ackNote ? `<br><span class="muted">“${esc(a.ackNote)}”</span>` : ""}</dd>` : ""}</dl>
      <div><h3 class="field-label" style="margin-bottom:8px">Timeline</h3><ol class="timeline">${[...a.timeline].reverse().map((t) => `<li><span class="num small muted">${absTime(t.at)}</span><span>${esc(t.what)}</span></li>`).join("")}</ol></div></div>`,
    foot: `${a.state === "active" ? `<button class="btn btn--primary" data-act="al-ack" data-ids="${a.id}">Acknowledge…</button>` : `<button class="btn btn--primary" data-act="ov-close">Done</button>`}`,
  });
}
Object.assign(ACT, {
  "al-tab": (el) => { S.aSel.clear(); setQuery("tab", el.dataset.val === "active" ? null : el.dataset.val); },
  "al-open": (el) => openAlarm(el.dataset.id),
  "al-sel": (el) => { S.aSel.has(el.dataset.id) ? S.aSel.delete(el.dataset.id) : S.aSel.add(el.dataset.id); render(); },
  "al-sel-clear": () => { S.aSel.clear(); render(); },
  "al-ack": (el) => {
    const ids = el.dataset.ids.split(",");
    closeAllOv();
    openSheet({
      title: ids.length > 1 ? `Acknowledge ${ids.length} alarms` : "Acknowledge", sub: ids.length > 1 ? "" : esc(ALARMS.find((a) => a.id === ids[0]).title),
      body: `<div class="stack"><div class="field"><label for="ack-note">Note <span class="opt">optional</span></label><textarea class="textarea" id="ack-note" placeholder="What you're doing about it" autofocus></textarea><div class="hint">Everyone sees who acknowledged it and this note. It still clears by itself when its condition is false again.</div></div></div>`,
      foot: `<button class="btn btn--ghost" data-act="ov-close">Cancel</button><button class="btn btn--primary" data-act="al-ack-do" data-ids="${ids.join(",")}">Acknowledge</button>`,
    });
  },
  "al-ack-do": (el) => {
    const note = $("#ack-note")?.value.trim() || "";
    const ids = el.dataset.ids.split(",");
    const prev = ids.map((id) => [id, clone(ALARMS.find((a) => a.id === id))]);
    for (const id of ids) {
      const a = ALARMS.find((x) => x.id === id);
      Object.assign(a, { state: "acknowledged", ackBy: WORKSPACE.user, ackAt: Date.now(), ackNote: note });
      a.timeline.push({ at: Date.now(), what: `Acknowledged by ${WORKSPACE.user}${note ? ": " + note : ""}` });
    }
    S.aSel.clear();
    popOv();
    render();
    toast({ title: ids.length > 1 ? `${ids.length} alarms acknowledged` : "Alarm acknowledged", detail: "It moved to Acknowledged.", undo: () => prev.forEach(([id, a]) => Object.assign(ALARMS.find((x) => x.id === id), a)) });
  },
});

/* ---------- Dashboard edit ---------- */
const W_TYPES = [["value", "Value card", "One live reading"], ["trend", "Trend chart", "A reading over time"], ["gauge", "Gauge", "A number against its range"], ["status", "Device status", "Online, last seen, signal"], ["actuator", "Actuator control", "Switch it On or Off"]];
const W_SIZES = [[3, "S"], [4, "M"], [8, "L"], [12, "Full"]];
const wDevices = (type) => DEVICES.filter((d) => (type === "actuator" ? tplOf(d).actuators.length : type === "status" ? true : tplOf(d).metrics.some((m) => type !== "gauge" || m.type === "number")));
const wMetrics = (type, dev) => (tplOf(devById(dev))?.metrics || []).filter((m) => type !== "gauge" || m.type === "number");
const wTitle = (w) => { const d = devById(w.device); if (w.title) return w.title; if (w.type === "status") return d?.name; if (w.type === "actuator") return `${tplOf(d)?.actuators.find((a) => a.key === w.actuator)?.name} · ${d?.name}`; return `${metricOf(d, w.metric)?.name} · ${d?.name}`; };
function fixWidget(w) {
  if (!wDevices(w.type).some((d) => d.id === w.device)) w.device = wDevices(w.type)[0]?.id;
  if (w.type === "actuator") { w.metric = undefined; if (!tplOf(devById(w.device)).actuators.some((a) => a.key === w.actuator)) w.actuator = tplOf(devById(w.device)).actuators[0]?.key; }
  else if (w.type === "status") { w.metric = undefined; w.actuator = undefined; }
  else { w.actuator = undefined; if (!wMetrics(w.type, w.device).some((m) => m.key === w.metric)) w.metric = wMetrics(w.type, w.device)[0]?.key; }
}
const wSel = (key, label, opts, cur) => `<div class="field"><label for="ws-${key}">${label}</label><select class="select" id="ws-${key}" data-wset="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
function widgetFields(w) {
  return `<div class="stack">
    ${wSel("type", "Type", W_TYPES.map(([v, l]) => [v, l]), w.type)}
    <div class="grid-2">${wSel("device", "Device", wDevices(w.type).map((d) => [d.id, d.name]), w.device)}
    ${w.type === "actuator" ? wSel("actuator", "Actuator", tplOf(devById(w.device)).actuators.map((a) => [a.key, a.name]), w.actuator) : w.type === "status" ? "" : wSel("metric", "Reading", wMetrics(w.type, w.device).map((m) => [m.key, m.name]), w.metric)}</div>
    <div class="field"><label for="ws-title">Title <span class="opt">optional</span></label><input class="input" id="ws-title" data-wset="title" value="${esc(w.title || "")}" placeholder="${esc(wTitle({ ...w, title: "" }))}"></div>
    <div class="field"><span class="field-label">Size</span><div class="seg" role="radiogroup" aria-label="Size">${W_SIZES.map(([v, l]) => `<button type="button" role="radio" aria-checked="${w.span === v}" tabindex="${w.span === v ? 0 : -1}" data-act="w-span" data-val="${v}">${l}</button>`).join("")}</div><div class="hint">On a phone every widget is full width.</div></div>
  </div>`;
}
function openWidget(dbId, wId) {
  S.wEdit = { db: dbId, w: wId };
  openSheet({
    title: "Widget", sub: "Changes apply as you make them",
    body: ovLive("wsheet", () => { const db = DASHBOARDS.find((x) => x.id === dbId); const w = db?.widgets.find((x) => x.id === wId); return w ? widgetFields(w) : null; }),
    foot: `<button class="btn btn--link-danger" data-act="w-remove" data-db="${dbId}" data-w="${wId}">Remove widget</button><span class="grow"></span><button class="btn btn--primary" data-act="ov-close">Done</button>`,
    onClose: () => { S.wEdit = null; },
  });
}
const curWidget = () => DASHBOARDS.find((x) => x.id === S.wEdit?.db)?.widgets.find((x) => x.id === S.wEdit?.w);
function addWidgetBody() {
  const a = S.wAdd;
  const steps = ["Type", "Source", "Size"];
  const head = `<p class="small muted" style="margin-bottom:14px">Step <b>${a.step + 1} of 3</b> · ${steps[a.step]}</p>`;
  if (a.step === 0) return head + `<div class="lines">${W_TYPES.map(([t, l, s]) => `<button class="line" data-act="wa-type" data-type="${t}"><span class="l-main"><b>${l}</b><span>${s}</span></span>${ic("chevR", 15)}</button>`).join("")}</div>`;
  if (a.step === 1) return head + `<div class="stack">${wSel("device", "Device", wDevices(a.type).map((d) => [d.id, d.name]), a.device).replace(/data-wset/g, "data-wadd")}${a.type === "actuator" ? wSel("actuator", "Actuator", tplOf(devById(a.device)).actuators.map((x) => [x.key, x.name]), a.actuator).replace(/data-wset/g, "data-wadd") : a.type === "status" ? "" : wSel("metric", "Reading", wMetrics(a.type, a.device).map((m) => [m.key, m.name]), a.metric).replace(/data-wset/g, "data-wadd")}
    <div class="row"><button class="btn btn--ghost" data-act="wa-step" data-dir="-1">Back</button><span class="grow"></span><button class="btn btn--primary" data-act="wa-step" data-dir="1">Next: Size</button></div></div>`;
  return head + `<div class="stack"><div class="seg" role="radiogroup" aria-label="Size">${W_SIZES.map(([v, l]) => `<button type="button" role="radio" aria-checked="${a.span === v}" data-act="wa-span" data-val="${v}">${l}</button>`).join("")}</div><p class="small">Adds <b>${esc(wTitle(a))}</b> as a ${W_TYPES.find((x) => x[0] === a.type)[1].toLowerCase()}.</p>
    <div class="row"><button class="btn btn--ghost" data-act="wa-step" data-dir="-1">Back</button><span class="grow"></span><button class="btn btn--primary" data-act="wa-add">Add widget</button></div></div>`;
}
Object.assign(ACT, {
  "w-open": (el) => openWidget(el.dataset.db, el.dataset.w),
  "w-span": (el) => { const w = curWidget(); if (w) { w.span = +el.dataset.val; render(); } },
  "w-add": (el) => {
    S.wAdd = { db: el.dataset.db, step: 0, type: "value", device: "d1", metric: "temperature", span: 4 };
    openSheet({ title: "Add a widget", body: ovLive("wadd", () => (S.wAdd ? addWidgetBody() : null)), onClose: () => { S.wAdd = null; } });
  },
  "wa-type": (el) => { Object.assign(S.wAdd, { type: el.dataset.type, step: 1, span: el.dataset.type === "trend" ? 8 : 4 }); fixWidget(S.wAdd); render(); },
  "wa-step": (el) => { S.wAdd.step += +el.dataset.dir; render(); },
  "wa-span": (el) => { S.wAdd.span = +el.dataset.val; render(); },
  "wa-add": () => {
    const a = S.wAdd;
    const db = DASHBOARDS.find((x) => x.id === a.db);
    db.widgets.push({ id: uid("w"), type: a.type, device: a.device, metric: a.metric, actuator: a.actuator, span: a.span });
    popOv();
    render();
    toast({ title: "Widget added", detail: esc(wTitle(a)) });
  },
});
document.addEventListener("change", (e) => {
  const el = e.target.closest?.("[data-wset]");
  if (el) { const w = curWidget(); if (!w) return; w[el.dataset.wset] = el.value || undefined; if (el.dataset.wset !== "title") fixWidget(w); render(); }
  const ad = e.target.closest?.("[data-wadd]");
  if (ad && S.wAdd) { S.wAdd[ad.dataset.wadd] = ad.value; fixWidget(S.wAdd); render(); }
});

/* ---------- Commands: the 30 s time limit ---------- */
setInterval(() => {
  let changed = false;
  for (const [dev, acts] of Object.entries(ACTUATORS)) for (const [key, st] of Object.entries(acts)) {
    if (st.pending && Date.now() > st.at + 30e3) {
      Object.assign(st, { pending: false, failed: true });
      const c = COMMANDS.find((x) => x.device === dev && x.actuator === key && x.status === "pending");
      if (c) c.status = "no_response";
      changed = true;
    }
  }
  for (const el of $$("[data-deadline]")) el.textContent = Math.max(0, Math.ceil((+el.dataset.deadline - Date.now()) / 1000));
  if (changed && /^\/devices\/|^\/dashboards\//.test(S.path) && !OV.length) render();
}, 1000);

Object.assign(ACT, {
  "dash-done": () => { S.dashEdit = false; if (S.q.get("edit")) setQuery("edit", null); else render(); },
  "cmd-f": (el) => { S.cmdFilter[el.dataset.k] = el.dataset.val; render(); },
});
document.addEventListener("change", (e) => {
  const el = e.target.closest?.("[data-cmdf]");
  if (el) { S.cmdFilter.act = el.value; render(); }
});
