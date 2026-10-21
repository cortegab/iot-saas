/* h-rules.js — Rules in demo H: list with KPIs and a ladder overview, recipes,
   a wizard for new rules, tabs for editing, one condition or action at a time
   in a side sheet, and the expert Ladder view opening the same sheets. */

const RULE_STEPS = [["when", "When"], ["if", "If"], ["then", "Then"], ["behaviour", "Behaviour"], ["name", "Review"]];
const ruleMode = () => store.get("rule-mode") || "form";
const blankRule = (devId) => ({ name: "", enabled: true, when: { type: "metric", mode: "daily", cron: "0 8 * * *", tz: WORKSPACE.tz, dev: devId || "", status: "disconnected" }, condition: null, behaviour: "rearm", hold: 10, cooldown: 60, clearDelay: 0, actions: [], clearNotify: false, clearMessage: "" });
const firstAllowed = (ac) => String(ac?.allowed || "").split(",")[0].trim();
const dayWord = (t) => { const d = new Date(t), n = new Date(); const tm = new Date(n); tm.setDate(n.getDate() + 1); return d.toDateString() === n.toDateString() ? `Today ${F_TIME.format(d)}` : d.toDateString() === tm.toDateString() ? `Tomorrow ${F_TIME.format(d)}` : absTime(+d); };
const fieldMsg = (path) => { const m = edMsg(path); return m.err ? `<div class="msg-err" style="margin-top:8px">${ic("alert", 13)}<span>${esc(m.err)}</span></div>` : ""; };
const goSec = (sec) => {
  if (ED?.wizard) { ED.step = Math.max(0, RULE_STEPS.findIndex((s) => s[0] === sec)); render(); return; }
  setQuery("tab", sec);
};
function genName(d) {
  const l = leavesOf(d.condition)[0];
  const head = l ? (() => { const m = devMetric(l.dev, l.metric); const ar = OPS[l.op]?.[1]; return `${m?.name || "Reading"} ${OPS[l.op][0]}${ar === 1 && l.rhs === "static" ? " " + (m?.type === "bool" ? (l.value ? "On" : "Off") : `${l.value} ${unitOf(m)}`.trim()) : ""}`; })() : triggerText(d.when);
  return clip(`${head} → ${d.actions[0] ? actionText(d.actions[0]) : "…"}`, 80);
}

/* ---------- Editor plumbing ---------- */
function resetLeafType(l) {
  const m = devMetric(l.dev, l.metric);
  if (m?.type === "bool") { if (!opsFor(m).includes(l.op)) l.op = "=="; if (typeof l.value !== "boolean") l.value = true; l.hyst = 0; l.rhs = "static"; }
  else { if (!opsFor(m).includes(l.op)) l.op = ">"; if (typeof l.value === "boolean") l.value = null; if (!(l.hyst > 0)) l.hyst = 1; }
}
function ruleOnSet(path, v) {
  const d = ED.draft;
  let m = path.match(/^leaf#(\w+)\.(dev|metric|op|rhsDev)$/);
  if (m) {
    const l = findNode(d.condition, m[1])[0];
    if (m[2] === "dev") { l.metric = tplOf(devById(l.dev))?.metrics[0]?.key || ""; resetLeafType(l); }
    if (m[2] === "metric") resetLeafType(l);
    if (m[2] === "op" && OPS[l.op][1] !== 1) l.rhs = "static";
    if (m[2] === "rhsDev") l.rhsMetric = tplOf(devById(l.rhsDev))?.metrics.find((x) => x.type !== "bool")?.key || "";
  }
  m = path.match(/^actions#(\w+)\.(dev|act|clearValue)$/);
  if (m) {
    const a = d.actions.find((x) => x.uid === m[1]);
    if (m[2] === "dev") a.act = devActs(a.dev)[0]?.key || "";
    if (m[2] !== "clearValue") { const ac = devActs(a.dev).find((x) => x.key === a.act); a.value = ac?.control === "values" ? firstAllowed(ac) : true; a.clearValue = null; }
    if (m[2] === "clearValue" && v === "") a.clearValue = null;
  }
  if (path === "when.type" && v === "device_status" && !d.when.dev) d.when.dev = DEVICES[0].id;
  if (path === "when.type" && v === "schedule" && !cronValid(d.when.cron)) d.when.cron = "0 8 * * *";
}
function openRuleEditor(key, init, { rule = null, isNew = false } = {}) {
  return useEditor(key, init, {
    validate: ruleValidate,
    isNew,
    noun: isNew ? "the new rule" : rule.draft.name,
    ruleId: rule?.id,
    onSave: (d, before) => (isNew ? createRule(d) : saveRule(rule, d, before)),
    onSet: ruleOnSet,
  });
}
function createRule(d) {
  const draft = clone(d);
  if (!draft.name.trim()) draft.name = genName(draft);
  const r = { id: uid("r"), state: draft.enabled ? "armed" : "disabled", fired24: 0, strip: "", draft, versions: [{ v: 1, by: WORKSPACE.user, at: Date.now(), lines: ["Created"], draft: clone(draft) }] };
  RULES.push(r);
  syncRule(r);
  ED.leaving = true;
  S.newRule = null;
  toast({ title: "Rule created", detail: `${esc(draft.name)} is ${draft.enabled ? "armed and applies within a second" : "disabled"}.` });
  navigate(`#/rules/${r.id}`);
}
async function saveRule(r, d, before) {
  if (r.draft.enabled) {
    const ok = await confirmDlg({ title: "Save and apply now?", body: `${esc(r.draft.name)} is enabled, so the change applies within a second.`, confirm: "Save rule", danger: false });
    if (ok !== "ok") return false;
  }
  const lines = ruleDiff(before, d);
  r.versions.unshift({ v: r.versions[0].v + 1, by: WORKSPACE.user, at: Date.now(), lines: lines.length ? lines : ["No visible changes"], draft: clone(d) });
  r.draft = clone(d);
  syncRule(r);
  Object.assign(ED, { orig: clone(d), submitted: false, restored: null });
  ED.touched.clear();
  toast({ title: "Rule saved", detail: `${changeSummary(lines) || "No visible changes."} Version ${r.versions[0].v}.` });
  render();
}
const ruleBar = (label) => {
  const I = ruleIssues(ED.draft);
  const b = I.filter((i) => i.level === "block" && (ED.submitted || shown(i.path))).length;
  const w = I.filter((i) => i.level === "warn").length;
  return savebar(label, `${b ? `<span class="pill pill--err">${b} to fix</span>` : ""}${w ? `<span class="pill pill--warn">${plural(w, "safety warning")}</span>` : ""}`);
};

/* ---------- Sheets ---------- */
function leafFields(l) {
  const d = ED.draft;
  const p = `leaf#${l.uid}`;
  const m = devMetric(l.dev, l.metric);
  const ar = OPS[l.op]?.[1];
  const u = unitOf(m);
  const devOpts = DEVICES.filter((x) => tplOf(x).metrics.length).map((x) => ({ v: x.id, l: x.name, g: zoneName(x.zone) }));
  const metricOpts = (dev) => (tplOf(devById(dev))?.metrics || []).map((x) => ({ v: x.key, l: x.name + (x.unit && x.type !== "bool" ? ` (${x.unit})` : x.type === "bool" ? " (On/Off)" : "") }));
  const showHyst = m && m.type !== "bool" && INEQ.includes(l.op);
  const hwOpen = showHyst && hardware(d) && d.when.type === "metric";
  const hint = showHyst && typeof l.value === "number" ? (l.op.startsWith(">") ? `Re-arms below ${+(l.value - (l.hyst || 0)).toFixed(2)} ${u}.` : `Re-arms above ${+(l.value + (l.hyst || 0)).toFixed(2)} ${u}.`) : "How far back it must go before it can fire again.";
  const hyst = fld({ path: p + ".hyst", label: "Hysteresis", type: "number", affix: u, hint });
  let value = "";
  if (ar === 1 && l.rhs !== "metric") value = m?.type === "bool" ? `<div class="field"><span class="field-label">Value</span>${seg(p + ".value", [[true, "On"], [false, "Off"]], undefined, "Value")}<div class="hint"></div></div>` : fld({ path: p + ".value", label: "Value", type: "number", affix: u });
  const rhsFields = ar === 1 && l.rhs === "metric" ? `<div class="grid-2">${fld({ path: p + ".rhsDev", label: "Other device", type: "select", options: devOpts, placeholder: "Pick a device" })}${fld({ path: p + ".rhsMetric", label: "Its reading", type: "select", options: metricOpts(l.rhsDev).filter((o) => !/On\/Off/.test(o.l)), placeholder: "Pick a reading" })}</div>` : "";
  const range = ar === 2 ? `<div class="grid-2">${fld({ path: p + ".low", label: "From", type: "number", affix: u })}${fld({ path: p + ".high", label: "To", type: "number", affix: u })}</div>` : "";
  const set = ar === 3 ? fld({ path: p + ".set", label: "Values", hint: "Separated by commas, e.g. 1, 2, 5" }) : "";
  const more = (ar === 1 && m?.type !== "bool") || (showHyst && !hwOpen);
  const now = READINGS[l.dev]?.[l.metric];
  return `<div class="stack">
    <div class="grid-2">${fld({ path: p + ".dev", label: "Device", type: "select", options: devOpts, placeholder: "Pick a device" })}${fld({ path: p + ".metric", label: "Reading", type: "select", options: metricOpts(l.dev), placeholder: "Pick a reading" })}</div>
    <div class="grid-2">${fld({ path: p + ".op", label: "Comparison", type: "select", options: opsFor(m).map((o) => ({ v: o, l: OPS[o][0] })) })}${value}</div>
    ${rhsFields}${range}${set}
    ${hwOpen ? hyst : ""}
    ${more ? `<details class="disclosure" ${l.rhs === "metric" || (showHyst && !hwOpen && l.hyst > 0) ? "open" : ""}><summary>More options</summary><div class="disc-body stack">${ar === 1 && m?.type !== "bool" ? `<div class="field"><span class="field-label">Compare with</span>${seg(p + ".rhs", [["static", "A value"], ["metric", "Another reading"]], undefined, "Compare with")}<div class="hint">Another reading compares two sensors, e.g. inside vs outside temperature.</div></div>` : ""}${showHyst && !hwOpen ? hyst : ""}</div></details>` : ""}
    <p class="small muted">${now && now[0] != null ? `Now: ${fmtReading(m, now[0])}${u && m?.type !== "bool" ? " " + u : ""}, ${agoEl(now[1])}` : "No reading from it yet."}</p>
  </div>`;
}
function openLeafSheet(id) {
  openSheet({
    title: "Condition", sub: "One thing that has to be true",
    body: ovLive("rsheet", () => { const l = ED && findNode(ED.draft.condition, id)[0]; return l ? leafFields(l) : null; }),
    foot: `<button class="btn btn--link-danger" data-act="r-rm-node" data-uid="${id}">Remove condition</button><span class="grow"></span><button class="btn btn--primary" data-act="ov-close">Done</button>`,
  });
}
function openGroupSheet(id) {
  openSheet({
    title: "Group", sub: "Conditions combined with All (in series) or Any (in parallel)",
    body: ovLive("rsheet", () => {
      const g = ED && findNode(ED.draft.condition, id)[0];
      if (!g || g.kind !== "group") return null;
      return `<div class="stack"><div class="field"><span class="field-label">Match</span><div class="seg" role="radiogroup" aria-label="Match">${[["all", "All of these (series)"], ["any", "Any of these (parallel)"]].map(([v, l]) => `<button role="radio" aria-checked="${g.op === v}" tabindex="${g.op === v ? 0 : -1}" data-act="r-grp-op" data-uid="${g.uid}" data-val="${v}">${l}</button>`).join("")}</div></div>
        <div class="lines">${g.children.map((c) => (c.kind === "leaf" ? `<button class="line" data-act="open-leaf" data-uid="${c.uid}"><span class="l-main"><b>${esc(cap(leafText(c)))}</b></span>${ic("chevR", 15)}</button>` : `<button class="line" data-act="lad-group" data-uid="${c.uid}"><span class="l-main"><b>${c.op === "all" ? "All" : "Any"} of ${c.children.length}</b><span>${esc(condHtml(c, false))}</span></span>${ic("chevR", 15)}</button>`)).join("")}</div>
        <div class="add-row"><button class="btn btn--secondary btn--sm" data-act="r-add-leaf" data-uid="${g.uid}">${ic("plus", 14)}Condition</button><button class="btn btn--ghost btn--sm" data-act="r-add-group" data-uid="${g.uid}">${ic("plus", 14)}${g.op === "all" ? "Any-of" : "All-of"} group</button></div></div>`;
    }),
    foot: `<button class="btn btn--link-danger" data-act="r-rm-node" data-uid="${id}">Remove group</button><span class="grow"></span><button class="btn btn--primary" data-act="ov-close">Done</button>`,
  });
}
function ruleActionFields(a) {
  const d = ED.draft;
  const p = `actions#${a.uid}`;
  if (a.type === "actuator") {
    const ac = devActs(a.dev).find((x) => x.key === a.act);
    const value = ac?.control === "values"
      ? fld({ path: p + ".value", label: "Set it to", type: "select", options: String(ac.allowed).split(",").map((s) => ({ v: s.trim(), l: s.trim() })) })
      : `<div class="field"><span class="field-label">Set it to</span>${seg(p + ".value", [[true, "On"], [false, "Off"]], undefined, "Set it to")}<div class="hint">Sent on QoS 1 with a 30 s time limit.</div></div>`;
    return `<div class="stack">
      <div class="grid-2">${fld({ path: p + ".dev", label: "Device", type: "select", options: DEVICES.filter((x) => tplOf(x).actuators.length).map((x) => ({ v: x.id, l: x.name, g: zoneName(x.zone) })), placeholder: "Pick a device" })}${fld({ path: p + ".act", label: "Actuator", type: "select", options: devActs(a.dev).map((x) => ({ v: x.key, l: x.name })), placeholder: "Pick one" })}</div>
      ${value}
      ${canClear(d) ? `${switchFld({ path: p + ".revert", label: "When the condition clears", on: "Turn it back", off: "Leave it", hint: `Sends ${ac?.control === "values" ? (a.clearValue || "its first value") : `“${unesc(fmtVal(clearValueOf(a)))}”`} once the condition is false again${d.clearDelay ? ` for ${d.clearDelay} s` : ""}.`, hintOff: "It stays as it is when the condition clears." })}
        ${a.revert && ac?.control === "values" ? fld({ path: p + ".clearValue", label: "Back to", type: "select", options: String(ac.allowed).split(",").map((s) => ({ v: s.trim(), l: s.trim() })) }) : ""}` : `<p class="small muted">Turning it back when the condition clears is for reading rules that re-arm.</p>`}
    </div>`;
  }
  if (a.type === "email") return `<div class="stack">${fld({ path: p + ".to", label: "To", optional: true, hint: `Separated by commas. Empty uses the alert recipients: ${esc(WORKSPACE.recipients.join(", "))}.` })}${fld({ path: p + ".subject", label: "Subject" })}${fld({ path: p + ".body", label: "Message", type: "textarea" })}<p class="small muted">Sent as “IO Driven Platform Alerts”.</p></div>`;
  if (a.type === "webhook") return `<div class="stack">${fld({ path: p + ".url", label: "Address", type: "url", placeholder: "https://…" })}${fld({ path: p + ".body", label: "Body", type: "textarea", hint: "JSON. Posted as is." })}</div>`;
  return `<div class="stack">${fld({ path: p + ".message", label: "Message", type: "textarea", hint: "Shown in Notifications with the rule's name." })}</div>`;
}
function openActionSheet(id) {
  const a = ED.draft.actions.find((x) => x.uid === id);
  if (!a) return;
  openSheet({
    title: { actuator: "Switch an actuator", email: "Send an email", webhook: "Call a webhook", notification: "Post a notification" }[a.type], sub: "Action",
    body: ovLive("rsheet", () => { const x = ED?.draft.actions.find((y) => y.uid === id); return x ? ruleActionFields(x) : null; }),
    foot: `<button class="btn btn--link-danger" data-act="r-rm-action" data-uid="${id}">Remove action</button><span class="grow"></span><button class="btn btn--primary" data-act="ov-close">Done</button>`,
  });
}
function previewCards(d, selfId) {
  const rp = replay(d), ws = wouldSend(d), ck = ruleChecks(d), ot = otherRulesOn(d, selfId);
  return `<div class="pv">
    <section class="pv-card"><h3>Last 24 hours</h3>${rp.cells ? stripHtml(rp.cells, "Replay of the last 24 hours") : ""}<p class="small">${esc(rp.text)}</p>${rp.noisy ? `<div class="callout callout--warn small">${ic("warn", 15)}<span>Noisy: it would fire very often. Add hold time or hysteresis.</span></div>` : ""}</section>
    <section class="pv-card"><h3>Would send</h3>${ws.length ? ws.map((w) => `<div class="pv-send"><div class="small"><b>${esc(w.t)}</b></div><div class="code">${esc(w.code)}</div></div>`).join("") : '<p class="small muted">No actions yet.</p>'}
      <button class="btn btn--secondary btn--sm" data-act="r-dry">${ic("play", 13)}Dry run with live readings</button><p class="hint">Reports what would happen now. Sends nothing.</p></section>
    <section class="pv-card"><h3>Checks</h3><ul class="checks">${ck.map(([lv, t]) => `<li>${lv === "ok" ? ic("check", 14, "tone-online") : lv === "warn" ? '<span class="ck-warn" aria-hidden="true">!</span>' : ic("x", 14, "icon-err")}<span>${t}</span><span class="sr-only">${lv === "ok" ? " passed" : lv === "warn" ? " safety warning" : " must be fixed"}</span></li>`).join("")}</ul></section>
    ${ot.length ? `<section class="pv-card"><h3>Other rules on these actuators</h3>${ot.map((o) => `<p class="small"><a href="#/rules/${o.r.id}">${esc(o.r.draft.name)}</a> also switches ${esc(actName(o.a))}.${o.conflict ? ' <span class="tag tag--warn">conflict</span> The last command wins.' : ""}</p>`).join("")}</section>` : ""}
  </div>`;
}

/* ---------- Sentence popovers (bottom sheet on phones) ---------- */
function openPop(anchor, title, body, apply) {
  const key = [anchor.dataset.act, anchor.dataset.uid || ""];
  S.popApply = apply;
  const refocus = () => setTimeout(() => $(`#rule-sentence [data-act="${key[0]}"]${key[1] ? `[data-uid="${key[1]}"]` : ""}`)?.focus(), 30);
  if ($("#frame").clientWidth < 640) {
    openSheet({ title, bottom: true, body: `<div class="stack">${body}</div>`, foot: `<button class="btn btn--ghost" data-act="ov-close">Cancel</button><button class="btn btn--primary" data-act="pop-apply">Apply</button>`, onClose: refocus });
    return;
  }
  const fr = $("#frame").getBoundingClientRect(), r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left - fr.left, fr.width - 330));
  pushOv(`<div class="pop-scrim" data-act="ov-close"></div><div class="pop" role="dialog" aria-modal="true" aria-label="${esc(title)}" style="left:${left}px;top:${r.bottom - fr.top + 6}px"><div class="pop-t">${esc(title)}</div><div class="stack">${body}</div><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn btn--ghost btn--sm" data-act="ov-close">Cancel</button><button class="btn btn--primary btn--sm" data-act="pop-apply">Apply</button></div></div>`, { onClose: refocus });
}
const popBool = (v) => `<div class="seg" role="radiogroup" aria-label="Value">${[[true, "On"], [false, "Off"]].map(([x, l]) => `<button type="button" role="radio" aria-checked="${v === x}" data-act="pop-bool" data-val="${x}">${l}</button>`).join("")}</div>`;
const popVal = (layer) => { const b = layer.querySelector('[data-act="pop-bool"][aria-checked="true"]'); return b ? b.dataset.val === "true" : null; };

Object.assign(ACT, {
  "pop-bool": (el) => $$('[data-act="pop-bool"]', el.parentElement).forEach((b) => b.setAttribute("aria-checked", String(b === el))),
  "pop-apply": () => { const layer = OV[OV.length - 1].el; S.popApply?.(layer); popOv(); render(); },
  "chip-leaf": (el) => {
    const l = findNode(ED.draft.condition, el.dataset.uid)[0];
    const m = devMetric(l.dev, l.metric);
    if (!m || OPS[l.op][1] !== 1 || l.rhs !== "static") { goSec("if"); setTimeout(() => openLeafSheet(l.uid)); return; }
    const opts = opsFor(m).filter((o) => OPS[o][1] === 1);
    openPop(el, `${m.name} on ${devById(l.dev).name}`, `<div class="grid-2"><div class="field"><label for="pop-op">Comparison</label><select class="select" id="pop-op">${opts.map((o) => `<option value="${o}" ${o === l.op ? "selected" : ""}>${OPS[o][0]}</option>`).join("")}</select></div>${m.type === "bool" ? `<div class="field"><span class="field-label">Value</span>${popBool(l.value)}</div>` : `<div class="field"><label for="pop-val">Value</label><div class="affix"><input class="input" id="pop-val" type="number" step="any" value="${esc(l.value ?? "")}" autofocus><span>${esc(unitOf(m))}</span></div></div>`}</div><button class="btn btn--link small" data-act="pop-full" data-uid="${l.uid}" style="align-self:flex-start">Open the full condition</button>`, (layer) => {
      l.op = $("#pop-op", layer).value;
      if (m.type === "bool") l.value = popVal(layer);
      else { const v = $("#pop-val", layer).value; l.value = v === "" ? null : Number(v); }
      ED.touched.add(`leaf#${l.uid}.value`);
    });
  },
  "pop-full": (el) => { popOv(); goSec("if"); setTimeout(() => openLeafSheet(el.dataset.uid)); },
  "chip-hold": (el) => openPop(el, "Hold time", `<div class="field"><label for="pop-val">True for at least</label><div class="affix"><input class="input" id="pop-val" type="number" min="0" value="${ED.draft.hold}" autofocus><span>s</span></div><div class="hint">Under 5 s, a single noisy reading can fire it.</div></div>`, (layer) => { ED.draft.hold = Number($("#pop-val", layer).value) || 0; }),
  "chip-act": (el) => {
    const a = ED.draft.actions.find((x) => x.uid === el.dataset.uid);
    openPop(el, actName(a), `<div class="field"><span class="field-label">Set it to</span>${popBool(a.value)}</div>`, (layer) => { const v = popVal(layer); if (v != null) a.value = v; });
  },
  "chip-goto": (el) => { const id = el.dataset.uid; goSec(el.dataset.sec); if (id) setTimeout(() => openActionSheet(id)); },
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.closest?.(".pop, .sheet--bottom") && e.target.id === "pop-val" && S.popApply) { e.preventDefault(); ACT["pop-apply"](); }
});

/* ---------- Tree, actions, behaviour, schedule ---------- */
function leafLine(l) {
  const n = issueAt(`leaf#${l.uid}`, "block").length;
  const w = issueAt(`leaf#${l.uid}`, "warn").length;
  const m = devMetric(l.dev, l.metric);
  const sub = OPS[l.op]?.[1] === 0 ? "an event: no value needed" : l.hyst > 0 && INEQ.includes(l.op) ? `hysteresis ${l.hyst}${unitOf(m) ? " " + m.unit : ""}` : m?.type === "bool" ? "on/off reading" : INEQ.includes(l.op) ? "no hysteresis" : "";
  return `<button type="button" class="line ${n ? "has-err" : ""}" data-act="open-leaf" data-uid="${l.uid}"><span class="l-main"><b>${esc(cap(leafText(l)))}</b>${sub ? `<span>${sub}</span>` : ""}</span><span class="l-end">${n ? `${ic("alert", 15, "icon-err")}<span class="sr-only">${plural(n, "problem")}</span>` : w ? '<span class="sb sb--warn" aria-label="safety warning">!</span>' : ""}${ic("chevR", 15)}</span></button>`;
}
function groupHtml(g, depth) {
  const sep = `<div class="rg-sep" aria-hidden="true">${g.op === "all" ? "and" : "or"}</div>`;
  const kids = g.children.map((c) => (c.kind === "leaf" ? `<div class="lines">${leafLine(c)}</div>` : groupHtml(c, depth + 1))).join(sep);
  return `<div class="rg ${depth ? "rg--nested" : ""}" role="group" aria-label="${g.op === "all" ? "All" : "Any"} of these">
    <div class="rg-h"><div class="seg" role="radiogroup" aria-label="Match">${[["all", "All"], ["any", "Any"]].map(([v, l]) => `<button role="radio" aria-checked="${g.op === v}" tabindex="${g.op === v ? 0 : -1}" data-act="r-grp-op" data-uid="${g.uid}" data-val="${v}">${l}</button>`).join("")}</div><span class="small muted">of these${depth ? "" : " must be true"}</span>${depth ? `<button class="btn btn--link-danger small" style="margin-left:auto" data-act="r-rm-node" data-uid="${g.uid}">Remove group</button>` : ""}</div>
    <div class="rg-body">${kids}</div>
    <div class="add-row"><button class="btn btn--secondary btn--sm" data-act="r-add-leaf" data-uid="${g.uid}">${ic("plus", 14)}Condition</button><button class="btn btn--ghost btn--sm" data-act="r-add-group" data-uid="${g.uid}">${ic("plus", 14)}${g.op === "all" ? "Any-of" : "All-of"} group</button></div></div>`;
}
function treeHtml(d) {
  const root = d.condition;
  const optional = d.when.type !== "metric";
  if (!root) return `<div class="card empty" style="padding:26px 16px"><b>${optional ? "No conditions (optional)" : "No conditions yet"}</b>${optional ? "It fires on its trigger. Add one to fire only when it's also true." : "Say what has to be true for it to fire."}<div class="add-row" style="justify-content:center"><button class="btn btn--primary" data-act="r-add-leaf">${ic("plus", 15)}Add condition</button></div></div>${fieldMsg("condition")}`;
  if (root.kind === "leaf") return `<div class="lines">${leafLine(root)}</div><div class="add-row"><button class="btn btn--secondary btn--sm" data-act="r-add-leaf" data-mode="all">${ic("plus", 14)}And condition</button><button class="btn btn--ghost btn--sm" data-act="r-add-leaf" data-mode="any">${ic("plus", 14)}Or condition</button></div>`;
  return groupHtml(root, 0);
}
function actionsHtml(d) {
  const line = (a) => {
    const n = issueAt(`actions#${a.uid}`, "block").length;
    const sub = a.type === "actuator" ? `${devById(a.dev)?.name || "no device"}${a.revert && canClear(d) ? ` · back ${unesc(fmtVal(clearValueOf(a)))} when it clears` : ""}` : a.type === "email" ? a.subject || "no subject" : a.type === "webhook" ? a.url || "no address" : a.message || "no message";
    return `<button type="button" class="line ${n ? "has-err" : ""}" data-act="open-action" data-uid="${a.uid}">${ic({ actuator: "toggle", email: "mail", webhook: "globe", notification: "bell" }[a.type], 16, "muted")}<span class="l-main"><b>${esc(cap(actionText(a)))}</b><span>${esc(sub)}</span></span><span class="l-end">${n ? `${ic("alert", 15, "icon-err")}<span class="sr-only">${plural(n, "problem")}</span>` : ""}${ic("chevR", 15)}</span></button>`;
  };
  return `${d.actions.length ? `<div class="lines">${d.actions.map(line).join("")}</div>` : `<div class="card empty" style="padding:26px 16px"><b>No actions yet</b>Say what happens when it fires.</div>`}
    <div class="add-row"><button class="btn btn--secondary" data-act="menu" data-menu="r-add" aria-haspopup="menu" aria-expanded="false">${ic("plus", 15)}Add action</button></div>${fieldMsg("actions")}
    ${canClear(d) && (d.actions.some((a) => a.revert) || d.clearNotify) ? `<p class="small muted" style="margin-top:14px">When it clears${d.clearDelay ? ` (after ${d.clearDelay} s)` : ""}: ${esc([...d.actions.filter((a) => a.type === "actuator" && a.revert).map((a) => actionText(a, true)), ...(d.clearNotify ? ["post a notification"] : [])].join(", "))}. <button class="btn btn--link small" data-act="r-goto" data-sec="behaviour">Change in Behaviour</button></p>` : ""}`;
}
MENUS["r-add"] = () => [
  { label: "Switch an actuator", act: "r-add-action", attrs: 'data-type="actuator"', icon: "toggle" },
  { label: "Send an email", act: "r-add-action", attrs: 'data-type="email"', icon: "mail" },
  { label: "Call a webhook", act: "r-add-action", attrs: 'data-type="webhook"', icon: "globe" },
  { label: "Post a notification", act: "r-add-action", attrs: 'data-type="notification"', icon: "bell" },
];
const ILL_REARM = `<svg width="92" height="40" viewBox="0 0 92 40" aria-hidden="true" class="ill"><path d="M2 32h14v-20h14v20h18v-20h14v20h28" fill="none" stroke="var(--color-chart)" stroke-width="1.6"/><circle cx="16" cy="6" r="3" fill="var(--color-accent)"/><circle cx="48" cy="6" r="3" fill="var(--color-accent)"/></svg>`;
const ILL_LATCH = `<svg width="92" height="40" viewBox="0 0 92 40" aria-hidden="true" class="ill"><path d="M2 32h14v-20h14v20h18v-20h14v20h28" fill="none" stroke="var(--color-chart)" stroke-width="1.6"/><circle cx="16" cy="6" r="3" fill="var(--color-accent)"/><path d="M16 6H90" stroke="var(--color-status-pending)" stroke-width="1.6" stroke-dasharray="3 3"/></svg>`;
function behaviourBody(d) {
  const metric = d.when.type === "metric";
  const card = (v, t, s, ill) => `<button type="button" class="choice choice--ill" role="radio" aria-checked="${d.behaviour === v}" data-act="set" data-path="behaviour" data-val="${v}" data-vt="string"><span class="radio"></span><span><b>${t}</b><span>${s}</span></span>${ill}</button>`;
  return `<div class="stack" style="gap:24px">
    <div class="field"><span class="field-label" id="beh-l">After it fires</span><div class="choices" role="radiogroup" aria-labelledby="beh-l">${card("rearm", "Re-arm", "Fires again the next time the condition becomes true.", ILL_REARM)}${card("latch", "Latch until reset", "Fires once, then stays latched until someone resets it.", ILL_LATCH)}</div></div>
    <div><div class="field-label" style="margin-bottom:8px">Safety <span class="opt">always applied; they stop hardware flapping</span></div><div class="grid-3">
      ${fld({ path: "hold", label: "Hold time", type: "number", affix: "s", disabled: !metric, hint: metric ? "True this long before it fires." : "Only for reading rules." })}
      ${fld({ path: "cooldown", label: "Minimum interval", type: "number", affix: "s", hint: "Time between two firings." })}
      ${fld({ path: "clearDelay", label: "Clear delay", type: "number", affix: "s", disabled: !canClear(d), hint: canClear(d) ? "False this long before it clears." : "Only for reading rules that re-arm." })}
    </div></div>
    <div>${canClear(d) ? switchFld({ path: "clearNotify", label: "Notify when it clears", on: "On", off: "Off", hint: "Posts a notification once the condition is false again.", hintOff: "Nothing is posted when it clears." }) + (d.clearNotify ? fld({ path: "clearMessage", label: "Message", type: "textarea" }) : "") : `<p class="small muted">Actions on clear are for reading rules that re-arm.</p>`}</div>
  </div>`;
}
function schedulePicker(w) {
  const s = parseSchedule(w.cron);
  const mode = w.mode === "custom" ? "custom" : s.mode;
  const sel = (key, opts, cur, label) => `<select class="select sch-sel" data-sch="${key}" aria-label="${label}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const mins = [...new Set([...Array(12).keys()].map((i) => i * 5).concat(s.m))].sort((a, b) => a - b);
  const time = `<div class="field"><span class="field-label">At</span><div class="row">${sel("h", [...Array(24).keys()].map((h) => [h, pad2(h)]), s.h, "Hour")}<span aria-hidden="true">:</span>${sel("m", mins.map((m) => [m, pad2(m)]), s.m, "Minute")}</div><div class="hint">24-hour time.</div></div>`;
  let body = "";
  if (mode === "daily") body = time;
  if (mode === "days") body = `<div class="field"><span class="field-label">On</span><div class="row row--wrap">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<button type="button" class="day" aria-pressed="${s.days.includes(i)}" data-act="sch-day" data-d="${i}">${DOWS[i].slice(0, 2)}</button>`).join("")}<button type="button" class="btn btn--link small" data-act="sch-days" data-set="1,2,3,4,5">Weekdays</button><button type="button" class="btn btn--link small" data-act="sch-days" data-set="0,6">Weekends</button></div><div class="hint">At least one day stays selected.</div></div>${time}`;
  if (mode === "repeat") body = `<div class="field"><span class="field-label">Every</span><div class="row">${sel("every", [...Array(s.unit === "min" ? 59 : 23).keys()].map((i) => [i + 1, i + 1]), s.every, "Every")}${sel("unit", [["min", "minutes"], ["hour", "hours"]], s.unit, "Unit")}</div></div>`;
  if (mode === "monthly") body = `<div class="field"><span class="field-label">On day</span><div class="row">${sel("dom", [...Array(28).keys()].map((i) => [i + 1, ordinal(i + 1)]), s.dom, "Day of month")}</div><div class="hint">Days 29–31 aren't offered: short months would skip them.</div></div>${time}`;
  if (mode === "custom") body = fld({ path: "when.cron", label: "Cron", mono: true, hint: "minute hour day month weekday, e.g. <span class='mono'>30 7 * * 1-5</span>" });
  const runs = nextRuns(w.cron);
  return `<div class="stack">
    <div class="seg" role="radiogroup" aria-label="Repeat">${[["daily", "Every day"], ["days", "Certain days"], ["repeat", "Repeatedly"], ["monthly", "Monthly"], ["custom", "Custom"]].map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === mode}" tabindex="${v === mode ? 0 : -1}" data-act="sch-mode" data-val="${v}">${l}</button>`).join("")}</div>
    ${body}
    <div class="grid-2">${fld({ path: "when.tz", label: "Time zone", type: "select", options: tzOptions(w.tz) })}</div>
    ${live("schsum", () => { const x = ED.draft.when; return `<p class="sch-sum">${cronValid(x.cron) ? `Runs <b>${esc(cronText(x.cron))}</b> (${esc(tzCity(x.tz))}, ${tzOffset(x.tz)}). Next: ${nextRuns(x.cron).map(dayWord).join(" · ")}` : "Fix the schedule to see when it runs."}</p>`; })}
  </div>`;
}
function whenBody(d) {
  const w = d.when;
  const card = (v, t, s) => `<button type="button" class="choice" role="radio" aria-checked="${w.type === v}" data-act="set" data-path="when.type" data-val="${v}" data-vt="string"><span class="radio"></span><span><b>${t}</b><span>${s}</span></span></button>`;
  const extra = w.type === "metric" ? `<p class="muted small">It checks every reading from the devices in its conditions, the moment it arrives.</p>`
    : w.type === "schedule" ? schedulePicker(w)
    : w.type === "manual" ? `<p class="muted small">It fires only when someone presses <b>Run now</b>. Any conditions are checked at that moment.</p>`
    : `<div class="grid-2">${fld({ path: "when.dev", label: "Device", type: "select", options: DEVICES.map((x) => ({ v: x.id, l: x.name, g: zoneName(x.zone) })), placeholder: "Pick a device" })}<div class="field"><span class="field-label">When it</span>${seg("when.status", [["disconnected", "Disconnects"], ["connected", "Connects"]], undefined, "When it")}<div class="hint">Disconnects comes from its Last-Will, so it's immediate.</div></div></div>`;
  return `<div class="choices" role="radiogroup" aria-label="Trigger">${card("metric", "On each reading", "Checks every new reading.")}${card("schedule", "On a schedule", "Every day, certain days, or repeatedly.")}${card("manual", "Manually", "Only when someone runs it.")}${card("device_status", "Device connects or disconnects", "Online and offline events.")}</div><div style="margin-top:20px">${extra}</div>`;
}
const modeSeg = () => `<div class="row row--wrap" style="margin-bottom:16px;gap:10px"><div class="seg" role="radiogroup" aria-label="View">${[["form", "Form"], ["ladder", 'Ladder <span class="tag tag--sm" style="height:16px;font-size:10.5px">expert</span>']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${ruleMode() === v}" tabindex="${ruleMode() === v ? 0 : -1}" data-act="r-mode" data-val="${v}">${l}</button>`).join("")}</div>${ruleMode() === "ladder" ? '<span class="small muted">Click any element to change it.</span>' : ""}</div>`;
const LADDER_LEGEND = `<details class="disclosure" style="margin-top:10px"><summary>Legend</summary><div class="disc-body small muted lad-legend"><span><b>[ ]</b> condition</span><span><b>[/]</b> is Off / not</span><span><b>( )</b> switches, turns back on clear</span><span><b>(P)</b> switches, stays</span><span><b>(S)</b> latches</span><span><b>(✉) (⇢) (!)</b> email, webhook, notification</span><span>Series = all of these; stacked = any of these</span><span><b>(+)</b> right of the conditions: AND, in series</span><span><b>(+)</b> dashed, under a contact: OR, a branch to that contact</span><span><b>+ OR</b> under the block: an alternative to all of them</span></div></details>`;
const ladderPanel = () => `<div class="lad-wrap">${ladderHtml("rule-lad", () => ED?.draft)}</div>${LADDER_LEGEND}`;
function secBody(sec, d) {
  if (sec === "when") return whenBody(d);
  if (sec === "if") return modeSeg() + (ruleMode() === "ladder" ? ladderPanel() : treeHtml(d));
  if (sec === "then") return modeSeg() + (ruleMode() === "ladder" ? ladderPanel() : actionsHtml(d));
  if (sec === "behaviour") return behaviourBody(d);
  return "";
}

Object.assign(ACT, {
  "r-add-leaf": (el) => {
    const d = ED.draft;
    const leaf = newLeaf(d);
    const mode = el.dataset?.mode;
    if (!d.condition) d.condition = leaf;
    else if (el.dataset?.uid) findNode(d.condition, el.dataset.uid)[0].children.push(leaf);
    else if (d.condition.kind === "leaf") d.condition = newGroup(mode || "all", [d.condition, leaf]);
    else if (mode && d.condition.op !== mode) d.condition = newGroup(mode, [d.condition, leaf]);
    else d.condition.children.push(leaf);
    d.condition = normalize(d.condition);
    closeAllOv();
    render();
    setTimeout(() => openLeafSheet(leaf.uid));
  },
  "r-add-group": (el) => {
    const [g] = findNode(ED.draft.condition, el.dataset.uid);
    const ng = newGroup(g.op === "all" ? "any" : "all", [newLeaf(ED.draft), newLeaf(ED.draft)]);
    g.children.push(ng);
    closeAllOv();
    render();
    setTimeout(() => openLeafSheet(ng.children[0].uid));
  },
  "r-grp-op": (el) => { const [g] = findNode(ED.draft.condition, el.dataset.uid); g.op = el.dataset.val; ED.draft.condition = normalize(ED.draft.condition); render(); },
  "r-rm-node": async (el) => {
    const d = ED.draft;
    const [n, p] = findNode(d.condition, el.dataset.uid);
    if (!n) return;
    if (n.kind === "group" && (await confirmDlg({ title: "Remove this group?", body: `Its ${plural(leavesOf(n).length, "condition")} go with it.`, confirm: "Remove group" })) !== "ok") return;
    if (!p) d.condition = null; else p.children = p.children.filter((c) => c !== n);
    d.condition = normalize(d.condition);
    closeAllOv();
    render();
  },
  "open-leaf": (el) => openLeafSheet(el.dataset.uid),
  "open-action": (el) => openActionSheet(el.dataset.uid),
  "r-add-action": (el) => {
    const d = ED.draft;
    const t = el.dataset.type;
    let a;
    if (t === "actuator") { const dev = leavesOf(d.condition).map((l) => l.dev).find((x) => devActs(x).length) || DEVICES.find((x) => tplOf(x).actuators.length).id; const ac = devActs(dev)[0]; a = { uid: uid("x"), type: "actuator", dev, act: ac.key, value: ac.control === "values" ? firstAllowed(ac) : true, revert: canClear(d), clearValue: null }; }
    else if (t === "email") a = { uid: uid("x"), type: "email", to: "", subject: d.name || "", body: "" };
    else if (t === "webhook") a = { uid: uid("x"), type: "webhook", url: "", body: '{"text": "Rule fired"}' };
    else a = { uid: uid("x"), type: "notification", message: "" };
    d.actions.push(a);
    closeAllOv();
    render();
    setTimeout(() => openActionSheet(a.uid));
  },
  "r-rm-action": (el) => { ED.draft.actions = ED.draft.actions.filter((a) => a.uid !== el.dataset.uid); closeAllOv(); render(); },
  "r-mode": (el) => { store.set("rule-mode", el.dataset.val); render(); },
  "r-tab": (el) => setQuery("tab", el.dataset.val),
  "r-goto": (el) => goSec(el.dataset.sec),
  "r-preview": () => openSheet({ title: "Preview", sub: "Updates as you edit", body: ovLive("rprev", () => (ED ? previewCards(ED.draft, ED.ruleId) : null)) }),
  "r-dry": () => toast({ title: "Dry run with live readings", detail: esc(dryRun(ED.draft)) }),
  "r-restore": (el) => {
    const r = ruleById(el.dataset.id);
    const v = r.versions.find((x) => x.v === +el.dataset.v);
    ED.draft = clone(v.draft);
    ED.restored = v.v;
    setQuery("tab", "if");
    toast({ title: `Version ${v.v} loaded`, detail: "Nothing changes until you save." });
  },
  "lad-leaf": (el) => openLeafSheet(el.dataset.uid),
  "lad-group": (el) => openGroupSheet(el.dataset.uid),
  "lad-coil": (el) => openActionSheet(el.dataset.uid),
  "lad-add-leaf": () => ACT["r-add-leaf"]({ dataset: { mode: "all" } }),
  // OR under one contact: a parallel branch to just that contact.
  "lad-or": (el) => {
    const d = ED.draft;
    const [l, p] = findNode(d.condition, el.dataset.uid);
    const nl = newLeaf(d, l.dev);
    if (p && p.op === "any") p.children.splice(p.children.indexOf(l) + 1, 0, nl);
    else { const g = newGroup("any", [l, nl]); if (!p) d.condition = g; else p.children[p.children.indexOf(l)] = g; }
    d.condition = normalize(d.condition);
    render();
    setTimeout(() => openLeafSheet(nl.uid));
  },
  // OR under the block: an alternative to all the conditions together.
  "lad-or-all": () => {
    const d = ED.draft;
    const nl = newLeaf(d);
    if (d.condition.kind === "group" && d.condition.op === "any") d.condition.children.push(nl);
    else d.condition = newGroup("any", [d.condition, nl]);
    d.condition = normalize(d.condition);
    render();
    setTimeout(() => openLeafSheet(nl.uid));
  },
  "lad-add-coil": (el) => openMenu(el, MENUS["r-add"]()),
  "lad-timer": () => goSec("behaviour"),
  "lad-trigger": () => goSec("when"),
  "sch-mode": (el) => {
    const w = ED.draft.when;
    const s = parseSchedule(w.cron);
    w.mode = el.dataset.val;
    if (w.mode !== "custom") w.cron = buildCron({ ...s, mode: w.mode, days: s.days.length ? s.days : [1, 2, 3, 4, 5] });
    render();
  },
  "sch-day": (el) => {
    const w = ED.draft.when;
    const s = parseSchedule(w.cron);
    const d = +el.dataset.d;
    const days = s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d];
    if (!days.length) { toast({ title: "At least one day stays selected" }); return; }
    w.cron = buildCron({ ...s, mode: "days", days });
    render();
    setTimeout(() => $(`[data-act="sch-day"][data-d="${d}"]`)?.focus());
  },
  "sch-days": (el) => { const w = ED.draft.when; w.cron = buildCron({ ...parseSchedule(w.cron), mode: "days", days: el.dataset.set.split(",").map(Number) }); render(); },
  "recipe": (el) => { const r = recipesFor(S.recipeDev).find((x) => x.id === el.dataset.id); S.newRule = r ? r.build() : blankRule(S.recipeDev); S.newSeq = (S.newSeq || 0) + 1; navigate("#/rules/new/edit"); },
  "rule-run": async (el) => {
    const r = ruleById(el.dataset.id);
    const ok = await confirmDlg({ title: `Run ${esc(r.draft.name)} now?`, body: `${esc(dryRun(r.draft)).replace(" Nothing was sent.", "")} Running it really sends its actions if the condition holds.`, confirm: "Run now", danger: false });
    if (ok === "ok") toast({ title: "Ran once", detail: `${esc(r.draft.name)}: see Activity for what it did.` });
  },
  "reset-latch": async (el) => {
    const r = ruleById(el.dataset.id);
    const now = evalNode(r.draft.condition, Date.now());
    const ok = await confirmDlg({ title: `Reset ${esc(r.draft.name)}?`, body: `It re-arms now. ${now === true ? "Its condition is still true, so it would fire again immediately." : now === null ? "Its inputs have no fresh data, so it can't fire until they report." : "Its condition is false now, so it won't fire straight away."}`, details: `<ul>${leavesOf(r.draft.condition).map((l) => { const m = devMetric(l.dev, l.metric); const v = READINGS[l.dev]?.[l.metric]; return `<li>${esc(m?.name)} on ${esc(devById(l.dev)?.name)}: ${v && v[0] != null ? fmtReading(m, v[0]) : "no data"}</li>`; }).join("")}</ul>`, confirm: "Reset latch", danger: false });
    if (ok !== "ok") return;
    r.state = "armed";
    render();
    toast({ title: "Latch reset", detail: `${esc(r.draft.name)} is armed again.` });
  },
  "rule-dup": (el) => { const r = ruleById(el.dataset.id); const c = { id: uid("r"), state: "disabled", fired24: 0, strip: "", draft: { ...clone(r.draft), name: r.draft.name + " (copy)", enabled: false } }; RULES.push(c); syncRule(c); navigate(`#/rules/${c.id}`); toast({ title: "Rule duplicated", detail: "The copy starts disabled." }); },
  "rule-toggle": (el) => { const r = ruleById(el.dataset.id); const flip = () => { r.draft.enabled = !r.draft.enabled; syncRule(r); }; flip(); if (ED?.key === "rule:" + r.id) { ED.draft.enabled = r.draft.enabled; ED.orig.enabled = r.draft.enabled; } render(); toast({ title: `${r.draft.name} ${r.draft.enabled ? "enabled" : "disabled"}`, undo: flip }); },
  "r-view": (el) => setQuery("view", el.dataset.val === "list" ? null : el.dataset.val),
});
MENUS.rule = (el) => {
  const r = ruleById(el.dataset.id);
  return [
    { label: "Open", href: `#/rules/${r.id}` },
    { label: "Run now…", act: "rule-run", attrs: `data-id="${r.id}"` },
    ...(r.state === "latched" ? [{ label: "Reset latch…", act: "reset-latch", attrs: `data-id="${r.id}"` }] : []),
    { label: "Duplicate", act: "rule-dup", attrs: `data-id="${r.id}"` },
    { label: r.draft.enabled ? "Disable" : "Enable", act: "rule-toggle", attrs: `data-id="${r.id}"` },
    "-",
    { label: "Delete…", act: "rule-delete", attrs: `data-id="${r.id}"`, danger: true },
  ];
};
document.addEventListener("change", (e) => {
  const el = e.target.closest?.("[data-sch]");
  if (el && ED) {
    const w = ED.draft.when;
    const s = { ...parseSchedule(w.cron) };
    s[el.dataset.sch] = el.dataset.sch === "unit" ? el.value : Number(el.value);
    if (el.dataset.sch === "unit") s.every = Math.min(s.every, el.value === "min" ? 59 : 23);
    w.cron = buildCron(s) || w.cron;
    render();
    setTimeout(() => $(`[data-sch="${el.dataset.sch}"]`)?.focus());
  }
  const rd = e.target.closest?.("[data-recipe-dev]");
  if (rd) { S.recipeDev = rd.value; render(); }
});

/* ---------- Recipes (rule-recipes.ts) ---------- */
function recipesFor(devId) {
  const dv = devById(devId);
  const t = tplOf(dv);
  const num = t.metrics.filter((m) => m.type === "number");
  const bool = t.metrics.filter((m) => m.type === "bool");
  const acts = DEVICES.filter((x) => tplOf(x).actuators.length);
  const ownAct = t.actuators[0] ? { dev: dv.id, ac: t.actuators[0] } : acts[0] ? { dev: acts[0].id, ac: tplOf(acts[0]).actuators[0] } : null;
  const temp = num.find((m) => /temp/.test(m.key)) || num[0];
  const hum = num.find((m) => /hum/.test(m.key));
  const now = (m) => READINGS[dv.id]?.[m.key]?.[0];
  const leaf = (m, op, value, extra = {}) => ({ uid: uid("l"), kind: "leaf", dev: dv.id, metric: m.key, op, value, low: null, high: null, set: "", rhs: "static", rhsDev: "", rhsMetric: "", hyst: m.type === "bool" ? 0 : 1, ...extra });
  const actuator = (value, revert) => ({ uid: uid("x"), type: "actuator", dev: ownAct.dev, act: ownAct.ac.key, value: ownAct.ac.control === "values" ? firstAllowed(ownAct.ac) : value, revert, clearValue: null });
  const base = (over) => ({ ...blankRule(dv.id), ...over });
  return [
    { id: "too-hot", icon: "zap", title: "Turn something on when it's too hot", desc: `${temp?.name || "A reading"} above a value switches ${ownAct ? actName({ dev: ownAct.dev, act: ownAct.ac.key }) : "an actuator"}, and back when it clears.`, tags: ["switches hardware"], ok: !!temp && !!ownAct, why: "Needs a number reading and something to switch.",
      build: () => base({ condition: leaf(temp, ">", Math.round((now(temp) ?? 25) + 2), { hyst: 2 }), actions: [actuator(true, true)], hold: 10, cooldown: 60, clearDelay: 30 }) },
    { id: "door-open", icon: "mail", title: "Alert when a door stays open", desc: `${bool[0]?.name || "An on/off reading"} On for 2 minutes sends an email.`, tags: ["email"], ok: !!bool.length, why: "Needs an on/off reading.",
      build: () => base({ condition: leaf(bool[0], "==", true), hold: 120, cooldown: 600, actions: [{ uid: uid("x"), type: "email", to: "", subject: `${dv.name}: ${bool[0].name} left On`, body: `${bool[0].name} on ${dv.name} has been On for 2 minutes.` }] }) },
    { id: "humidity-low", icon: "activity", title: "Warn when humidity drops", desc: "Below 40 % posts a notification.", tags: [], ok: !!hum, why: "Needs a humidity reading.",
      build: () => base({ condition: leaf(hum, "<", 40, { hyst: 3 }), hold: 60, cooldown: 900, actions: [{ uid: uid("x"), type: "notification", message: `Humidity on ${dv.name} dropped below 40 %.` }] }) },
    { id: "tank-low", icon: "power", title: "Stop the pump when the tank is low", desc: "Switches off and stays off until someone resets it.", tags: ["switches hardware", "latches"], ok: !!num.length && !!ownAct, why: "Needs a number reading and something to switch.",
      build: () => base({ condition: leaf(num[0], "<", 10, { hyst: 1 }), behaviour: "latch", hold: 5, cooldown: 60, actions: [actuator(false, false)] }) },
    { id: "offline", icon: "wifi", title: "Tell me when this device goes offline", desc: "Its Last-Will posts a notification at once.", tags: [], ok: true,
      build: () => base({ when: { ...blankRule().when, type: "device_status", dev: dv.id, status: "disconnected" }, hold: 0, cooldown: 300, actions: [{ uid: uid("x"), type: "notification", message: `${dv.name} stopped reporting.` }] }) },
    { id: "schedule", icon: "play", title: "Switch something on a schedule", desc: "Every day at 08:00, set an actuator.", tags: ["switches hardware"], ok: !!ownAct, why: "Needs something to switch.",
      build: () => base({ when: { ...blankRule().when, type: "schedule", mode: "daily", cron: "0 8 * * *" }, hold: 0, cooldown: 3600, actions: [actuator(true, false)] }) },
  ];
}

/* ---------- Pages ---------- */
function pageRules() {
  const L = listState("rules", { st: "", dev: "", trig: "" });
  const view = S.q.get("view") === "ladder" ? "ladder" : "list";
  const q = L.q.toLowerCase();
  const kp = { armed: (r) => r.draft.enabled && r.state === "armed", fired: (r) => r.fired24 > 0, latched: (r) => r.state === "latched", cant: (r) => r.health === "cant", disabled: (r) => !r.draft.enabled };
  const rows = RULES.filter((r) => (!q || r.draft.name.toLowerCase().includes(q)) && (!L.st || kp[L.st](r)) && (!L.dev || ruleUses(r, [L.dev])) && (!L.trig || r.draft.when.type === L.trig)).sort(cmpBy(L, (r) => r.draft.name.toLowerCase()));
  const k = (key, label, tone, shape, sub) => `<button class="kpi" data-act="filter" data-list="rules" data-key="st" data-val="${L.st === key ? "" : key}" aria-pressed="${L.st === key}"><span class="k-l">${badge([label, tone, shape])}</span><span class="k-v">${RULES.filter(kp[key]).length}</span><span class="k-s">${sub}</span></button>`;
  const devs = DEVICES.filter((d) => RULES.some((r) => ruleUses(r, [d.id])));
  const toolbar = `<div class="toolbar">${searchBox("rules", "Search rules")}
    <select class="select" data-list="rules" data-key="dev" aria-label="Device"><option value="">All devices</option>${devs.map((d) => `<option value="${d.id}" ${L.dev === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>
    <select class="select" data-list="rules" data-key="trig" aria-label="Trigger"><option value="">All triggers</option>${[["metric", "On each reading"], ["schedule", "On a schedule"], ["manual", "Manually"], ["device_status", "Device online / offline"]].map(([v, l]) => `<option value="${v}" ${L.trig === v ? "selected" : ""}>${l}</option>`).join("")}</select>
    <div class="seg" role="radiogroup" aria-label="View">${[["list", "List"], ["ladder", "Ladder"]].map(([v, l]) => `<button role="radio" aria-checked="${view === v}" tabindex="${view === v ? 0 : -1}" data-act="r-view" data-val="${v}">${l}</button>`).join("")}</div>
    <span class="result-count">${rows.length} of ${RULES.length}</span></div>`;
  const chips = chipsFor("rules", [["st", "State", (v) => ({ armed: "Armed", fired: "Fired in 24 h", latched: "Latched", cant: "Can't evaluate", disabled: "Disabled" })[v]], ["dev", "Device", (v) => devById(v)?.name], ["trig", "Trigger", (v) => ({ metric: "On each reading", schedule: "On a schedule", manual: "Manually", device_status: "Device online / offline" })[v]]]);
  const activity = (r) => (r.draft.when.type === "schedule" ? esc(cronText(r.draft.when.cron)) : r.fired24 ? `fired ${r.fired24}× in 24 h` : "quiet in 24 h");
  const list = view === "ladder"
    ? `<div class="lad-cards">${rows.map((r) => `<a class="card lad-card" href="#/rules/${r.id}"><div class="row" style="margin-bottom:8px"><b class="grow trunc">${esc(r.draft.name)}</b>${ruleBadge(r)}</div>${ladderHtml("ro-" + r.id, () => r.draft, { readOnly: true })}</a>`).join("") || '<div class="card empty"><b>No rules match</b></div>'}</div>`
    : `<div class="tbl-wrap"><table class="tbl no-check"><thead><tr>${sortTh("rules", "name", "Rule")}<th class="col-p3">Trigger</th><th class="col-p2">Action</th><th>State</th><th class="w-menu"><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${rows.map((r) => { const sh = ruleShares(r); return `<tr data-act="nav" data-href="#/rules/${r.id}" tabindex="0" class="${r.draft.enabled ? "" : "is-disabled"}"><td><div class="cell-name"><a href="#/rules/${r.id}">${esc(r.draft.name)}</a><span class="sub row row--wrap" style="gap:8px">${r.draft.when.type === "metric" ? stripHtml(r.strip) : ""}<span>${activity(r)}</span>${sh ? `<span class="tag tag--warn">shares ${esc(sh)}</span>` : r.health === "cant" ? '<span class="tag">can\'t evaluate</span>' : ""}</span></div></td><td class="col-p3 c-extra">${esc(triggerText(r.draft.when))}</td><td class="col-p2 c-extra">${esc(r.draft.actions.map((a) => cap(actionText(a))).join(", "))}</td><td class="c-status">${ruleBadge(r)}</td><td class="w-menu">${menuBtn("rule", `Actions for ${r.draft.name}`, `data-id="${r.id}"`)}</td></tr>`; }).join("")}
      </tbody></table>${rows.length ? tblFoot(rows.length, RULES.length, "rules") : `<div class="empty"><b>No rules match</b><button class="btn btn--secondary" data-act="clear-filters" data-list="rules">Clear filters</button></div>`}</div>`;
  return `<div class="page">${ph({ title: "Rules", desc: "Every reading is checked against these the moment it arrives.", actions: `<a class="btn btn--primary" href="#/rules/new">${ic("plus", 15)}New rule</a>` })}
    <div class="kpis kpis--5" role="group" aria-label="Filter by state">${k("armed", "Armed", "online", "", "waiting for their condition")}${k("fired", "Fired", "accent", "", "in the last 24 h")}${k("latched", "Latched", "pending", "sq", "need a reset")}${k("cant", "Can't evaluate", "unknown", "ring", "an input has no data")}${k("disabled", "Disabled", "unknown", "sq", "not evaluated")}</div>
    ${toolbar}${chips}${list}</div>`;
}
function pageRuleNew() {
  S.recipeDev ||= "d1";
  const rs = recipesFor(S.recipeDev);
  const card = (r) => `<button type="button" class="card recipe" data-act="recipe" data-id="${r.id}" ${r.ok ? "" : 'disabled aria-disabled="true"'}><span class="row">${ic(r.icon, 18, "tone-accent")}<b>${esc(r.title)}</b></span><span class="small muted">${esc(r.ok ? r.desc : r.why)}</span>${r.tags.length ? `<span class="row row--wrap" style="gap:6px">${r.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</span>` : ""}</button>`;
  return `<div class="page">${ph({ crumbs: [["Rules", "#/rules"]], title: "New rule", desc: "Pick the device, then start from a recipe. Everything stays editable." })}
    <div class="field" style="max-width:360px;margin-bottom:20px"><label for="rec-dev">Device</label><select class="select" id="rec-dev" data-recipe-dev>${DEVICES.filter((d) => d.status !== "disabled").map((d) => `<option value="${d.id}" ${d.id === S.recipeDev ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select><div class="hint">Recipes come from what it measures and switches.</div></div>
    <div class="recipes">${rs.map(card).join("")}<button type="button" class="card recipe recipe--blank" data-act="recipe" data-id="blank"><span class="row">${ic("plus", 18, "muted")}<b>Start blank</b></span><span class="small muted">When, If, Then, step by step.</span></button></div></div>`;
}
/** The rule's top: name and status, then the live sentence. */
const ruleTop = (withName) => `${withName ? `<div class="grid-2 rule-meta">${fld({ path: "name", label: "Name", placeholder: "Left blank, a name is generated", hint: "" })}${switchFld({ path: "enabled", label: "Status", hint: "Fires when its trigger and conditions are met.", hintOff: "Keeps its settings and history, but won't fire." })}</div>` : ""}
  ${live("sentence", () => `<div class="sentence" id="rule-sentence" aria-label="The rule in a sentence">${ruleSentenceHtml(ED.draft)}</div>`)}`;
function pageRuleWizard() {
  if (!S.newRule) return pageRuleNew();
  const ed = openRuleEditor("rule:new:" + S.newSeq, () => clone(S.newRule), { isNew: true });
  ed.wizard = true;
  ed.step ??= 0;
  ed.onInvalid = (paths) => { const sec = ruleIssues(ED.draft).find((i) => paths.includes(i.path))?.sec; const i = RULE_STEPS.findIndex((s) => s[0] === sec); ED.step = i >= 0 ? i : RULE_STEPS.length - 1; };
  const d = ed.draft;
  const cur = RULE_STEPS[ed.step];
  const stepper = live("rsteps", () => `<ol class="wiz-steps" aria-label="Steps">${RULE_STEPS.map((s, i) => `<li class="${i < ED.step ? "done" : ""}" ${i === ED.step ? 'aria-current="step"' : ""}><span class="n" aria-hidden="true">${i < ED.step ? ic("check", 12) : i + 1}</span>${s[1]}${s[0] !== "name" ? secBadge(ED.draft, s[0]) : ""}<span class="sr-only">${i < ED.step ? " (done)" : i === ED.step ? " (current)" : ""}</span></li>`).join("")}</ol>
    <div class="wiz-compact"><div class="row"><span>Step <b>${ED.step + 1} of ${RULE_STEPS.length}</b> · ${RULE_STEPS[ED.step][1]}</span></div><div class="progress"><div style="width:${((ED.step + 1) / RULE_STEPS.length) * 100}%"></div></div></div>`);
  const qs = { when: ["What starts it?", "A reading, a schedule, a person, or a device going online or offline."], if: ["What has to be true?", "Add conditions. Combine them with All (and) or Any (or)."], then: ["What should happen?", "Switch something, send an email, call a webhook or post a notification."], behaviour: ["How should it behave?", "Re-arm or latch, and the safety timers that stop hardware flapping."], name: ["Check and create", "Name it, see what it would have done, and create it."] }[cur[0]];
  const body = cur[0] === "name"
    ? `<div class="stack" style="gap:20px"><div class="grid-2">${fld({ path: "name", label: "Name", optional: true, placeholder: genName(d), hint: "Left blank, the name shown here is used." })}${switchFld({ path: "enabled", label: "Status", hint: "Armed as soon as it's created.", hintOff: "Created disabled: it won't fire." })}</div>${live("pvinline", () => previewCards(ED.draft, null))}</div>`
    : secBody(cur[0], d);
  const last = ed.step === RULE_STEPS.length - 1;
  const foot = live("savebar", () => { const I = ruleIssues(ED.draft); const w = I.filter((i) => i.level === "warn").length; return `<div class="savebar"><div class="state"><span class="dot"></span><span class="trunc">Not created yet</span></div>${w ? `<span class="pill pill--warn">${plural(w, "safety warning")}</span>` : ""}
    ${ED.step ? `<button class="btn btn--ghost" data-act="rw-back">${ic("chevL", 15)}Back</button>` : `<a class="btn btn--ghost" href="#/rules/new">Recipes</a>`}
    ${last ? `<button class="btn btn--primary" data-act="ed-save">Create rule</button>` : `<button class="btn btn--primary" data-act="rw-next">Next: ${RULE_STEPS[ED.step + 1][1]}${ic("chevR", 15)}</button>`}</div>`; });
  return `<div class="page page--editor page--wide">${ph({ crumbs: [["Rules", "#/rules"], ["New rule", "#/rules/new"]], title: "New rule" })}${stepper}
    <div class="rule-layout"><div class="rule-main">${ruleTop(false)}<h2 class="wiz-q" id="wiz-q" tabindex="-1" style="margin-top:22px">${qs[0]}</h2><p class="wiz-lead">${qs[1]}</p>${body}</div>
    ${cur[0] === "name" ? "" : `<aside class="rule-pv" aria-label="Preview">${live("pv", () => previewCards(ED.draft, null))}</aside>`}</div>${foot}</div>`;
}
Object.assign(ACT, {
  "rw-next": () => {
    const sec = RULE_STEPS[ED.step][0];
    const errs = ruleIssues(ED.draft).filter((i) => i.sec === sec && i.level === "block");
    if (errs.length) {
      errs.forEach((i) => ED.touched.add(i.path));
      render();
      const f = $('#app [aria-invalid="true"], #app .line.has-err');
      if (f) f.focus(); else toast({ title: "Fix the marked items first", detail: esc(errs[0].text), tone: "error" });
      return;
    }
    ED.step++;
    render();
    $("#content").scrollTop = 0;
    $("#wiz-q")?.focus();
  },
  "rw-back": () => { ED.step = Math.max(0, ED.step - 1); render(); $("#wiz-q")?.focus(); },
});
function pageRule(id) {
  const r = ruleById(id);
  if (!r) return `<div class="page"><div class="empty"><b>Rule not found</b><a href="#/rules">Back to rules</a></div></div>`;
  const ed = openRuleEditor("rule:" + id, () => clone(r.draft), { rule: r });
  const tabs = [["when", "When"], ["if", "If"], ["then", "Then"], ["behaviour", "Behaviour"], ["activity", "Activity"]];
  let tab = S.q.get("tab") || "if";
  if (!tabs.some((t) => t[0] === tab)) tab = "if";
  ed.onInvalid = (paths) => { const sec = ruleIssues(ED.draft).find((i) => paths.includes(i.path))?.sec; if (sec && sec !== "name") { const q = new URLSearchParams(S.q); q.set("tab", sec); history.replaceState(null, "", `#${S.path}?${q}`); } };
  const d = ed.draft;
  const tabNav = live("rtabs", () => `<div class="tabs" role="tablist" aria-label="Rule sections">${tabs.map(([v, l]) => `<button role="tab" id="rt-${v}" aria-selected="${v === tab}" tabindex="${v === tab ? 0 : -1}" data-act="r-tab" data-val="${v}">${l}${v !== "activity" ? secBadge(ED.draft, v) : ""}</button>`).join("")}</div>`);
  const callouts = `${r.state === "latched" ? `<div class="callout callout--warn" style="margin-bottom:12px">${ic("lock", 16)}<span class="grow"><b>Latched.</b> It fired and won't fire again until someone resets it.</span><button class="btn btn--secondary btn--sm" data-act="reset-latch" data-id="${r.id}">Reset latch…</button></div>` : ""}
    ${r.health === "cant" ? `<div class="callout" style="margin-bottom:12px">${ic("info", 16)}<span><b>Can't evaluate now.</b> ${esc(leavesOf(r.draft.condition).map((l) => devById(l.dev)).filter((x) => x && x.status !== "online").map((x) => `${x.name} is ${DEV_ST[x.status][0].toLowerCase()}`).join("; "))}. Missing data never fires or clears it.</span></div>` : ""}
    ${ed.restored ? `<div class="callout" style="margin-bottom:12px">${ic("info", 16)}<span>Version ${ed.restored} is loaded. Save to make it current, or Discard.</span></div>` : ""}`;
  const body = tab === "activity" ? activityBody(r) : secBody(tab, d);
  return `<div class="page page--editor page--wide">${ph({
    crumbs: [["Rules", "#/rules"]],
    over: `Rule · ${ruleBadge(r)} · ${r.fired24 ? `fired ${r.fired24}× in 24 h` : "quiet in 24 h"}`,
    title: esc(d.name || r.draft.name),
    desc: `Saving applies within a second. It watches ${plural(ruleRefs({ draft: d }).devices.length, "device")}${hardware(d) ? ` and can switch ${plural(d.actions.filter((a) => a.type === "actuator").length, "actuator")}` : ""}.`,
    actions: `<button class="btn btn--secondary btn--keep pv-btn" data-act="r-preview">${ic("activity", 14)}Preview</button><button class="btn btn--secondary" data-act="rule-run" data-id="${r.id}">${ic("play", 14)}Run now…</button>${menuBtn("rule", "More actions", `data-id="${r.id}"`)}`,
  })}${callouts}
    <div class="rule-layout"><div class="rule-main">${ruleTop(true)}${tabNav}${body}</div><aside class="rule-pv" aria-label="Preview">${live("pv", () => previewCards(ED.draft, id))}</aside></div>
    ${tab === "activity" ? "" : live("savebar", () => ruleBar("Save rule"))}</div>`;
}
function activityBody(r) {
  const f = firingsFor(r);
  return `<section class="sec"><div class="sec-h"><h2>Last 24 hours</h2><span class="muted small">${r.draft.when.type === "schedule" ? esc(cronText(r.draft.when.cron)) : r.fired24 ? `fired ${r.fired24}×` : "quiet"}</span></div>${stripHtml(r.strip).replace('class="strip"', 'class="strip strip--wide"')}<div class="row small muted" style="justify-content:space-between;margin-top:4px"><span>${F_TIME.format(new Date(Date.now() - DAY))}</span><span>now</span></div></section>
    <section class="sec"><div class="sec-h"><h2>Recent firings</h2></div>${f.length ? `<div class="lines">${f.map((x) => `<div class="line" style="align-items:flex-start"><span class="num small muted nowrap" style="min-width:104px">${absTime(x.at)}</span><span class="l-main"><b>${x.what}</b>${x.outcomes.map((o) => `<span class="outcome">${o.ok ? ic("check", 13, "tone-online") : ic("alert", 13, "icon-err")} ${esc(o.label)}: ${esc(o.reason)}</span>`).join("")}</span></div>`).join("")}</div>` : `<p class="muted small">No firings in the last 24 hours.</p>`}</section>
    <section class="sec"><div class="sec-h"><h2>Versions</h2><span class="muted small">Restore loads one into the editor; nothing changes until you save.</span></div><div class="lines">${r.versions.map((v, i) => `<div class="line"><span class="l-main"><b>Version ${v.v}${i === 0 ? " · current" : ""}</b><span style="white-space:normal">${esc(v.by)} · ${absTime(v.at)} · ${esc(v.lines.join("; "))}</span></span>${i === 0 ? "" : `<button class="btn btn--secondary btn--sm" data-act="r-restore" data-id="${r.id}" data-v="${v.v}">Restore</button>`}</div>`).join("")}</div></section>`;
}
