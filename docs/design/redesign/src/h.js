/* Demo H — Guided: short steps to create, tabs to edit, one item at a time in a sheet. */

const setQuery = (k, v) => {
  const q = new URLSearchParams(S.q);
  if (v == null) q.delete(k); else q.set(k, v);
  const qs = q.toString();
  history.replaceState(null, "", `#${S.path}${qs ? "?" + qs : ""}`);
  render();
};
const secHtml = (s) => {
  const n = s.errPrefix ? errCount(s.errPrefix) : 0;
  return `<section class="sec ${s.danger ? "danger-sec" : ""}" id="sec-${s.id}" aria-labelledby="sh-${s.id}"><div class="sec-h"><h2 id="sh-${s.id}">${s.title}</h2>${n ? `<span class="tag" style="color:var(--color-status-error)">${plural(n, "problem")}</span>` : ""}</div>${s.lead ? `<p class="sec-lead">${s.lead}</p>` : ""}${s.body}</section>`;
};
const hSteps = (d) => [["basics", "Basics", ["general"]], ...(d.runsOn === "our" ? [["hardware", "Hardware", ["hardware"]]] : []), ["data", "Data", ["metrics", "actuators"]], ["review", "Review", []]];
const stepErrors = (step) => Object.keys(edCheck().E).filter((p) => step[2].includes(sectionOf(p)));

function hOpenPart(uidP) {
  const p = ED.draft.parts.find((x) => x.uid === uidP);
  if (!p) return;
  openSheet({
    title: esc(DRIVERS[p.driver].name), sub: "Part · its readings feed the metrics named here",
    body: ovLive("hsheet", () => { const x = ED?.draft.parts.find((q) => q.uid === uidP); return x ? partFields(ED.draft, x) : null; }),
    foot: `<button class="btn btn--primary" data-act="ov-close">Done</button>`,
  });
}
function hOpenRow(kind, uidR) {
  const row = ED.draft[kind].find((x) => x.uid === uidR);
  if (!row) return;
  openSheet({
    title: esc(row.name) || (kind === "metrics" ? "New metric" : "New actuator"), sub: kind === "metrics" ? "Metric" : "Actuator",
    body: ovLive("hsheet", () => { const r = ED?.draft[kind].find((q) => q.uid === uidR); return r ? (kind === "metrics" ? metricFields(ED.draft, r) : actuatorFields(ED.draft, r)) : null; }),
    foot: `<button class="btn btn--primary" data-act="ov-close">Done</button>`,
  });
}
Object.assign(ACT, {
  "h-rail": () => { S.railOpen = !S.railOpen; render(); },
  "h-more": () => openSheet({
    title: "More", bottom: true,
    body: `<div class="me"><span class="avatar" aria-hidden="true">CO</span><div class="grow"><b>${esc(WORKSPACE.user)}</b><div class="small muted">${esc(MEMBERS[0].email)} · ${WORKSPACE.role} of ${esc(WORKSPACE.name)}</div></div><a class="btn btn--secondary btn--sm" href="#/login">${ic("logout", 14)}Sign out</a></div><div class="lines">${NAV.flatMap(([, items]) => items).filter(([l]) => !["Dashboards", "Devices", "Notifications", "Rules"].includes(l)).map(([l, h, i]) => `<a class="line" href="${h}">${ic(i, 17, "muted")}<span class="l-main"><b>${l}</b></span>${ic("chevR", 15)}</a>`).join("")}</div>
      <div class="row" style="margin-top:16px;justify-content:space-between">${liveInd()}<button class="btn btn--secondary" data-act="theme">${ic(isDark() ? "sun" : "moon", 15)}${isDark() ? "Light" : "Dark"} theme</button></div>`,
  }),
  "h-tab": (el) => setQuery("tab", el.dataset.val),
  "h-view": (el) => setQuery("view", el.dataset.val === "logic" ? null : el.dataset.val),
  "open-part": (el) => hOpenPart(el.dataset.uid),
  "open-row": (el) => hOpenRow(el.dataset.kind, el.dataset.uid),
  "h-next": () => {
    const steps = hSteps(ED.draft);
    const errs = stepErrors(steps[ED.step]);
    if (errs.length) {
      errs.forEach((p) => ED.touched.add(p));
      render();
      $('#app [aria-invalid="true"]')?.focus();
      if (!$('#app [aria-invalid="true"]')) toast({ title: "Fix the marked items first", tone: "error" });
      return;
    }
    ED.step = Math.min(ED.step + 1, steps.length - 1);
    render();
    $("#content").scrollTop = 0;
    $("#wiz-q")?.focus();
  },
  "h-back": () => { ED.step = Math.max(0, ED.step - 1); render(); $("#wiz-q")?.focus(); },
  "h-goto": (el) => { ED.step = +el.dataset.step; render(); $("#wiz-q")?.focus(); },
});

function hWizard({ device, head, pre = "" }) {
  const ed = openTplEditor({ key: device ? "add:new" : "tpl:new", init: () => blankDraft("our", device ? { name: "", zone: "" } : null), tplId: null, noun: device ? "the new device" : "the new template" });
  ed.step ??= 0;
  const d = ed.draft;
  const steps = hSteps(d);
  ed.step = Math.min(ed.step, steps.length - 1);
  ed.onInvalid = (paths) => { const i = steps.findIndex((s) => paths.some((p) => s[2].includes(sectionOf(p)))); if (i >= 0) ed.step = i; };
  ed.onPartAdded = (p) => setTimeout(() => hOpenPart(p.uid));
  ed.onRowAdded = (k, r) => setTimeout(() => hOpenRow(k, r.uid));
  const cur = steps[ed.step];
  const visible = edErrors();
  const stepper = `<ol class="wiz-steps" aria-label="Steps">${steps.map((s, i) => `<li class="${i < ed.step ? "done" : ""} ${visible.some((p) => s[2].includes(sectionOf(p))) ? "has-err" : ""}" ${i === ed.step ? 'aria-current="step"' : ""}><span class="n" aria-hidden="true">${i < ed.step ? ic("check", 12) : i + 1}</span>${s[1]}<span class="sr-only">${i < ed.step ? " (done)" : i === ed.step ? " (current)" : ""}</span></li>`).join("")}</ol>
    <div class="wiz-compact"><div class="row"><span>Step <b>${ed.step + 1} of ${steps.length}</b> · ${cur[1]}</span></div><div class="progress"><div style="width:${((ed.step + 1) / steps.length) * 100}%"></div></div></div>`;
  let body = "";
  const q = (t, lead) => `<h2 class="wiz-q" id="wiz-q" tabindex="-1">${t}</h2><p class="wiz-lead">${lead}</p>`;
  if (cur[0] === "basics") {
    body = `${pre}${q(device ? "What is it?" : "Name the template", device ? "Name the device and say what it runs on." : "Then say what devices of this kind run on.")}
      <div class="wiz-block">${generalFields(d, { isNew: true })}</div><div class="wiz-block">${runsOnChoice(d)}</div>`;
  } else if (cur[0] === "hardware") {
    body = `${q("Which board and parts?", "Pick the board, then add each part wired to it. Every part brings its metrics or actuators.")}
      <div class="wiz-block">${boardFields(d)}</div>
      <div class="wiz-block"><h3>Parts ${d.parts.length ? `<span class="count" style="margin-left:0">${d.parts.length}</span>` : ""}</h3>
        ${d.parts.length ? `<div class="lines">${d.parts.map((p) => partLine(d, p)).join("")}</div>` : `<div class="empty card" style="padding:28px 16px"><b>No parts yet</b>Add the sensors and outputs wired to the board.</div>`}
        <div class="add-row"><button class="btn btn--secondary" data-act="add-part-open">${ic("plus", 15)}Add part</button></div></div>
      ${d.parts.length ? `<div class="wiz-block"><h3>What you'll see</h3>${whatYoullSee(d)}</div>` : ""}`;
  } else if (cur[0] === "data") {
    body = `${q("What does it publish and switch?", d.runsOn === "our" ? "Your parts brought these. Rename them, or fine-tune how often they publish." : "List the data your firmware sends, and anything it can switch.")}
      <div class="wiz-block"><h3>Metrics</h3>${d.metrics.length ? `<div class="lines">${d.metrics.map((m) => rowLine(d, "metrics", m)).join("")}</div>` : `<p class="muted small">None yet.</p>`}<div class="add-row"><button class="btn btn--secondary" data-act="add-row" data-kind="metrics">${ic("plus", 15)}Add metric</button></div></div>
      <div class="wiz-block"><h3>Actuators</h3>${d.actuators.length ? `<div class="lines">${d.actuators.map((a) => rowLine(d, "actuators", a)).join("")}</div>` : `<p class="muted small">None. Add one if the platform should switch something.</p>`}<div class="add-row"><button class="btn btn--secondary" data-act="add-row" data-kind="actuators">${ic("plus", 15)}Add actuator</button></div></div>`;
  } else {
    const rv = (k, v, step) => `<div class="rv"><dt>${k}</dt><dd>${v}</dd>${step != null ? `<button class="btn btn--link small" data-act="h-goto" data-step="${step}">Change</button>` : "<span></span>"}</div>`;
    const hi = steps.findIndex((s) => s[0] === "hardware");
    const di = steps.findIndex((s) => s[0] === "data");
    body = `${q(device ? "Check and create" : "Check and create the template", tplConsequence(d, null))}
      <dl class="review card card-pad">
        ${device ? rv("Device", `${esc(d.device.name) || '<span class="muted">Unnamed</span>'} · ${esc(zoneName(d.device.zone))}`, 0) : rv("Template", esc(d.name) || '<span class="muted">Unnamed</span>', 0)}
        ${rv("Runs on", d.runsOn === "our" ? "Our firmware" : "Custom firmware", 0)}
        ${d.runsOn === "our" ? rv("Board and parts", `${esc(boardName(d.board))}<div class="small muted">${esc(d.parts.map((p) => `${DRIVERS[p.driver].name} · ${pinsText(d, p)}`).join("; ")) || "No parts"}</div>`, hi) : ""}
        ${rv("Metrics", d.metrics.length ? d.metrics.map((m) => `${esc(m.name)} <span class="mono small muted">${esc(m.key)}</span>`).join(", ") : '<span class="muted">None</span>', di)}
        ${rv("Actuators", d.actuators.length ? d.actuators.map((a) => esc(a.name)).join(", ") : '<span class="muted">None</span>', di)}
      </dl>
      ${visible.length ? `<div class="callout callout--err" style="margin-top:16px">${ic("alert", 16)}<span><b>${plural(visible.length, "problem")} to fix.</b> The marked steps above show where.</span></div>` : ""}`;
  }
  const last = ed.step === steps.length - 1;
  const foot = live("savebar", () => `<div class="savebar"><div class="state ${edDirty() ? "" : "clean"}"><span class="dot"></span><span class="trunc">${edDirty() ? "Not created yet" : "Nothing entered yet"}</span></div>
    ${ed.step ? `<button class="btn btn--ghost" data-act="h-back">${ic("chevL", 15)}Back</button>` : ""}
    ${last ? `<button class="btn btn--primary" data-act="ed-save">${device ? "Create device" : "Create template"}</button>` : `<button class="btn btn--primary" data-act="h-next">Next: ${steps[ed.step + 1][1]}${ic("chevR", 15)}</button>`}</div>`);
  return `<div class="page page--editor">${head}${stepper}<div class="wiz-body">${body}</div>${foot}</div>`;
}

/* Rail tooltips: a floating label beside the icon (the nav scrolls, so a CSS
   ::after would be clipped). Only while the rail is collapsed. */
const hideTip = () => $$(".rail-tip").forEach((x) => x.remove());
function railTip(el) {
  hideTip();
  const side = el.closest(".side");
  if (!side || side.classList.contains("is-open") || side.offsetWidth > 100) return;
  const fr = $("#frame").getBoundingClientRect(), r = el.getBoundingClientRect();
  const t = document.createElement("div");
  t.className = "rail-tip";
  t.textContent = el.dataset.tip;
  t.style.left = r.right - fr.left + 10 + "px";
  t.style.top = r.top - fr.top + r.height / 2 + "px";
  $("#ov").appendChild(t);
}
document.addEventListener("mouseover", (e) => { const el = e.target.closest?.(".side [data-tip]"); if (el) railTip(el); else hideTip(); });
document.addEventListener("focusin", (e) => { const el = e.target.closest?.(".side [data-tip]"); if (el) railTip(el); else hideTip(); });
document.addEventListener("scroll", hideTip, true);

const DEMO = {
  afterRender: hideTip,
  name: "H — Guided",
  title: "Demo H: Guided",
  shell(page) {
    const items = NAV.map(([g, list]) => `<div class="nav-group"><span>${g}</span></div>${list.map(([l, h, i, c]) => `<a class="nav-item" href="${h}" ${isCurrent(h) ? 'aria-current="page"' : ""} data-tip="${l}" aria-label="${l}">${ic(i, 17)}<span class="lbl">${l}</span><span class="lbl-c">${navCount(c())}</span></a>`).join("")}`).join("");
    const unread = unackedAlarms();
    const tab = (l, h, i, extra = "") => `<a href="${h}" ${isCurrent(h) ? 'aria-current="page"' : ""}>${ic(i, 20)}${l}${extra}</a>`;
    return `<button class="skip" data-act="skip">Skip to content</button>
      <div class="side-wrap"><nav class="side ${S.railOpen ? "is-open" : ""}" aria-label="Main">
        <div class="side-top"><button class="ws" aria-label="Workspace: IO Driven"><span class="ws-logo">I</span><span class="lbl"><b>IO Driven</b><small>Owner · ${DEVICES.length} devices</small></span></button>
          <button class="btn btn--icon rail-pin" data-act="h-rail" aria-label="${S.railOpen ? "Collapse" : "Expand"} navigation" aria-expanded="${!!S.railOpen}">${ic("panel")}</button></div>
        <button class="search-trigger" data-act="palette" aria-label="Search or run, Ctrl K">${ic("search", 15)}<span class="lbl grow" style="text-align:left">Search or run…</span><span class="kbd lbl">⌘K</span></button>
        <div class="side-nav">${items}</div>
        <div class="side-foot"><span class="avatar" data-tip="${esc(WORKSPACE.user)} · ${WORKSPACE.role} · ${S.offline ? "Reconnecting…" : "Live updates on"}" aria-hidden="true">CO<span class="live-dot ${S.offline ? "off" : ""}"></span></span><span class="lbl grow"><b>${esc(WORKSPACE.user)}</b>${liveInd()}</span><button class="btn btn--icon" data-act="theme" aria-label="Switch to ${isDark() ? "light" : "dark"} theme">${ic(isDark() ? "sun" : "moon")}</button></div>
      </nav></div>
      <div class="main-col">
        <header class="topbar"><a href="#/dashboards" class="ws-logo" aria-label="IO Driven, go to dashboards" style="text-decoration:none">I</a><span class="tb-title">IO Driven</span><span class="grow"></span>${S.offline ? `<span class="live-ind off"><span class="dot"></span></span>` : ""}<button class="btn btn--icon" data-act="palette" aria-label="Search or run">${ic("search", 18)}</button></header>
        <main id="content" class="scroller" tabindex="-1">${netBanner()}${page}</main>
        <nav class="tabbar" aria-label="Main">${tab("Dashboards", "#/dashboards", "grid")}${tab("Devices", "#/devices", "cpu")}${tab("Alerts", "#/notifications", "bell", unread ? `<span class="alert-count" aria-label="${unread} unread">${unread}</span>` : "")}${tab("Rules", "#/rules", "rules")}<button data-act="h-more" aria-haspopup="dialog">${ic("menu", 20)}More</button></nav>
      </div>`;
  },
  frame(spec) {
    const main = spec.sections.filter((s) => !s.readOnly);
    const ro = spec.sections.filter((s) => s.readOnly);
    const view = ro.length && S.q.get("view") === "activity" ? "activity" : "logic";
    const tabs = ro.length ? `<div class="tabs" role="tablist" aria-label="View">${[["logic", "Logic"], ["activity", "Activity"]].map(([v, l]) => `<button role="tab" id="hv-${v}" aria-selected="${v === view}" tabindex="${v === view ? 0 : -1}" data-act="h-view" data-val="${v}">${l}</button>`).join("")}</div>` : "";
    if (view === "activity") return `${tabs}<div class="h-frame">${ro.map(secHtml).join("")}</div>`;
    return `${tabs}<div class="h-frame">${spec.summary ? `<div class="h-sum">${live("summary", () => spec.summary)}</div>` : ""}${main.map(secHtml).join("")}</div>${live("savebar", () => savebar(spec.saveLabel))}`;
  },
  deviceSettings(d) { return this.frame(deviceSettingsSpec(d)); },
  templateEditor(id) {
    if (!id) return hWizard({ device: false, head: ph({ crumbs: [["Device templates", "#/templates"]], title: "New device template" }) });
    const t = tplById(id);
    if (!t) return `<div class="page"><div class="empty"><b>Template not found</b></div></div>`;
    const ed = openTplEditor({ key: "tpl:" + id, init: () => tplDraft(t), tplId: id, noun: t.name });
    const d = ed.draft;
    const tabs = d.runsOn === "our" ? [["general", "General", ["general"]], ["wiring", "Wiring", ["hardware"]], ["data", "Data", ["metrics", "actuators"]]] : [["general", "General", ["general"]], ["data", "Data", ["metrics", "actuators"]]];
    ed.onInvalid = (paths) => { const tb = tabs.find((x) => x[2].includes(sectionOf(paths[0]))); if (tb) { const q = new URLSearchParams(S.q); q.set("tab", tb[0]); history.replaceState(null, "", `#${S.path}?${q}`); } };
    ed.onPartAdded = (p) => setTimeout(() => hOpenPart(p.uid));
    ed.onRowAdded = (k, r) => setTimeout(() => hOpenRow(k, r.uid));
    let tab = S.q.get("tab") || "general";
    if (!tabs.some((x) => x[0] === tab)) tab = "general";
    const vis = edErrors();
    const n = DEVICES.filter((x) => x.tpl === id).length;
    const tabNav = `<div class="tabs" role="tablist" aria-label="Template sections">${tabs.map(([v, l, secs]) => `<button role="tab" id="ht-${v}" aria-selected="${v === tab}" tabindex="${v === tab ? 0 : -1}" data-act="h-tab" data-val="${v}">${l}${vis.some((p) => secs.includes(sectionOf(p))) ? '<span class="err-dot"></span><span class="sr-only">has problems</span>' : ""}</button>`).join("")}</div>`;
    let body = "";
    if (tab === "general") {
      body = `<section class="sec">${generalFields(d, { isNew: false })}</section><section class="sec"><div class="sec-h"><h2>Runs on</h2></div><p class="muted">${d.runsOn === "our" ? "Our firmware: the board and parts are set in Wiring, and devices install from the browser." : "Custom firmware: you write the firmware; it publishes the metrics listed in Data."}</p></section>`;
    } else if (tab === "wiring") {
      body = `<section class="sec">${boardFields(d)}</section>
        <section class="sec"><div class="sec-h"><h2>Parts</h2><span class="count" style="margin-left:0">${d.parts.length}</span><span class="grow"></span><a class="small" href="#/templates/${id}/wiring">${ic("book", 13)} Wiring guide</a></div><p class="sec-lead">Each part brings its metrics or actuators. Open one to set its pins and name its readings.</p>
          ${d.parts.length ? `<div class="lines">${d.parts.map((p) => partLine(d, p)).join("")}</div>` : `<p class="muted small">No parts yet.</p>`}
          <div class="add-row"><button class="btn btn--secondary" data-act="add-part-open">${ic("plus", 15)}Add part</button></div></section>
        <section class="sec"><div class="sec-h"><h2>What you'll see</h2></div>${live("wys", () => whatYoullSee(ED.draft))}</section>`;
    } else {
      body = `<section class="sec"><div class="sec-h"><h2>Metrics</h2><span class="count" style="margin-left:0">${d.metrics.length}</span></div><p class="sec-lead">What the device publishes. Rules, dashboards and history point at these keys.</p>
          ${d.metrics.length ? `<div class="lines">${d.metrics.map((m) => rowLine(d, "metrics", m)).join("")}</div>` : `<p class="muted small">None yet.</p>`}
          <div class="add-row"><button class="btn btn--secondary" data-act="add-row" data-kind="metrics">${ic("plus", 15)}Add metric</button></div></section>
        <section class="sec"><div class="sec-h"><h2>Actuators</h2><span class="count" style="margin-left:0">${d.actuators.length}</span></div><p class="sec-lead">What the platform can switch.</p>
          ${d.actuators.length ? `<div class="lines">${d.actuators.map((a) => rowLine(d, "actuators", a)).join("")}</div>` : `<p class="muted small">None.</p>`}
          <div class="add-row"><button class="btn btn--secondary" data-act="add-row" data-kind="actuators">${ic("plus", 15)}Add actuator</button></div></section>`;
    }
    const head = ph({
      crumbs: [["Device templates", "#/templates"]],
      over: `Device template · ${t.enabled ? badge(["Enabled", "online", ""]) : badge(["Disabled", "unknown", "sq"])} · ${plural(n, "device")}`,
      title: esc(d.name || t.name),
      desc: tplConsequence(d, id),
      actions: `<button class="btn btn--secondary" data-act="tpl-dup" data-id="${id}">${ic("copy", 14)}Duplicate</button>${menuBtn("tpl", "More actions", `data-id="${id}"`)}`,
    });
    return `<div class="page page--editor">${head}${tabNav}<div class="h-frame">${body}</div>${live("savebar", () => savebar("Save"))}</div>`;
  },
  addDevice() {
    const start = defaultStart();
    const head = ph({ crumbs: [["Devices", "#/devices"]], title: "Add device", desc: start === "tpl" ? "Name it and pick its template. Next come its credential and Install." : "Say what it runs on and what's wired to it. Its template is made for you." });
    if (start === "tpl") {
      fromTemplateEditor();
      return `<div class="page page--editor">${head}<div class="h-frame"><section class="sec">${startChoice(start)}</section><section class="sec">${fromTemplateFields()}</section></div>${live("savebar", () => savebar("Create device"))}</div>`;
    }
    const ed = openTplEditor({ key: "add:new", init: () => blankDraft("our", { name: "", zone: "" }), tplId: null, noun: "the new device" });
    return hWizard({ device: true, head, pre: (ed.step ?? 0) === 0 ? `<div style="margin-bottom:28px">${startChoice(start)}</div>` : "" });
  },
};

boot(CORE_ROUTES);
