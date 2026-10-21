/* core-infra.js — router, rendering, overlays, events, editor state, fields,
   charts and the width-switcher harness. The demo
   (h.js) supplies `DEMO`: shell, frame, template editor, add device. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clone = (o) => JSON.parse(JSON.stringify(o));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
let UIDN = Date.now() % 1e7; // unique across reloads (a restored device keeps its id)
const uid = (p = "x") => p + ++UIDN;
const keyOf = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
const slugOf = (s) => keyOf(s).replace(/_/g, "-");
const store = {
  get(k) { try { return localStorage.getItem("demo:" + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem("demo:" + k, v); } catch { /* private mode */ } },
};

/* ---------- Icons (lucide-style strokes) ---------- */
const IC = {
  grid: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  rules: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  chevU: '<path d="m18 15-6-6-6 6"/>',
  more: '<circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
  battery: '<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  back: '<path d="m12 19-7-7 7-7M19 12H5"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  play: '<path d="m6 3 14 9-14 9V3z"/>',
  power: '<path d="M12 2v10M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  toggle: '<rect x="1" y="5" width="22" height="14" rx="7"/><circle cx="16" cy="12" r="3"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  move: '<path d="m5 9-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  usb: '<path d="M10 7h4v5h-4zM12 12v10M8 2h8v5H8z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
};
const ic = (n, s = 16, cls = "") => `<svg class="${cls}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ""}</svg>`;

/* ---------- Time: 24-hour, workspace zone (DESIGN §11) ---------- */
const TZ = WORKSPACE.tz;
const F_TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const F_TIME_S = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const F_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
function absTime(ts, secs = false) {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  const t = (secs ? F_TIME_S : F_TIME).format(d);
  return sameDay ? t : `${dayLabel(d)} ${t}`;
}
function ago(ts) {
  if (!ts) return "never";
  const s = (Date.now() - ts) / 1000;
  if (s < 10) return "just now";
  if (s < 60) return `${Math.floor(s)} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return absTime(ts);
}
const agoEl = (ts) => (ts ? `<time data-ago="${ts}" datetime="${new Date(ts).toISOString()}">${ago(ts)}</time>` : "never");

/* ---------- Lookups and status vocabulary ---------- */
const devById = (id) => DEVICES.find((d) => d.id === id);
const tplById = (id) => TEMPLATES.find((t) => t.id === id);
const tplOf = (d) => tplById(d.tpl);
const zoneName = (id) => ZONES.find((z) => z.id === id)?.name ?? "No zone";
const ruleById = (id) => RULES.find((r) => r.id === id);
const metricOf = (dev, key) => tplOf(dev)?.metrics.find((m) => m.key === key);
const DEV_ST = { online: ["Online", "online", ""], offline: ["Offline", "offline", ""], never: ["Never connected", "pending", "ring"], disabled: ["Disabled", "unknown", "sq"] };
const RULE_ST = { armed: ["Armed", "online", ""], fired: ["Fired", "accent", ""], latched: ["Latched", "pending", "sq"], disabled: ["Disabled", "unknown", "sq"] };
const badge = ([label, tone, shape]) => `<span class="badge tone-${tone}"><span class="dot ${shape ? "dot--" + shape : ""}"></span><span class="lbl">${label}</span></span>`;
const devBadge = (st) => badge(DEV_ST[st]);
const ruleBadge = (r) => badge(RULE_ST[r.enabled ? r.state : "disabled"]);
const SEV_TONE = { critical: ["Critical", "offline", "alert"], warning: ["Warning", "pending", "warn"], info: ["Info", "accent", "info"] };
function fmtReading(m, v) {
  if (v == null) return "—";
  if (m?.type === "bool") return v ? "On" : "Off";
  if (typeof v === "string") return esc(v);
  return Number(v).toFixed(m?.decimals ?? 1);
}
const unitOf = (m) => (m?.type === "bool" ? "" : m?.unit || "");
const fmtVal = (v) => (v === true ? "On" : v === false ? "Off" : esc(String(v)));

/* ---------- App state, routing, render ---------- */
const S = { route: "", path: "", q: new URLSearchParams(), offline: false, list: {}, sel: new Set(), used: null, peek: null, dashEdit: false };
let ED = null; // the open editor (one at a time)
const LIVE = {}; // live regions re-rendered on every keystroke
const CHARTS = {};
let ROUTES = [];

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}
function parseRoute() {
  const h = location.hash.slice(1) || "/dashboards/db1";
  const [p, qs] = h.split("?");
  S.path = p;
  S.q = new URLSearchParams(qs || "");
  S.route = h;
}
function pageFor(path) {
  for (const [re, fn, opts] of ROUTES) {
    const m = path.match(re);
    if (m) return { html: fn(...m.slice(1)), opts: opts || {} };
  }
  return { html: `<div class="page"><div class="empty"><b>Page not found</b><a href="#/dashboards">Go to dashboards</a></div></div>`, opts: {} };
}
function render() {
  parseRoute();
  const ae = document.activeElement;
  const focusId = ae && ae.id && $("#app").contains(ae) ? ae.id : null;
  const caret = focusId && "selectionStart" in ae ? [ae.selectionStart, ae.selectionEnd] : null;
  const sc = $("#content");
  const scrollTop = sc && S.lastPath === S.path ? sc.scrollTop : 0;
  S.used = null;
  S.guard = null;
  for (const k in LIVE) delete LIVE[k];
  const { html, opts } = pageFor(S.path);
  if (!S.used) ED = null;
  $("#app").innerHTML = opts.bare ? `<main id="content" class="scroller" tabindex="-1">${html}</main>` : DEMO.shell(html);
  const nsc = $("#content");
  if (nsc) nsc.scrollTop = scrollTop;
  S.lastPath = S.path;
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus({ preventScroll: true });
      if (caret && "setSelectionRange" in el) try { el.setSelectionRange(caret[0], caret[1]); } catch { /* number inputs */ }
    }
  }
  for (const el of $$("[data-live]")) el._html = LIVE_HTML[el.dataset.live];
  drawCharts();
  drawLadders();
  refreshOvLive();
  DEMO.afterRender?.();
}
/* Live regions inside overlays (a sheet that edits the open draft). */
const OVLIVE = {};
const ovLive = (name, fn) => { OVLIVE[name] = fn; return `<div data-ovlive="${name}">${fn()}</div>`; };
function refreshOvLive() {
  for (const el of $$("#ov [data-ovlive]")) {
    const fn = OVLIVE[el.dataset.ovlive];
    if (!fn) continue;
    const ae = document.activeElement;
    const id = el.contains(ae) ? ae.id : null;
    const caret = id && "selectionStart" in ae ? [ae.selectionStart, ae.selectionEnd] : null;
    const html = fn();
    if (html == null) { popOv(); continue; }
    if (el._html === html) continue;
    el.innerHTML = html;
    el._html = html;
    if (id) {
      const n = document.getElementById(id);
      if (n) { n.focus({ preventScroll: true }); if (caret) try { n.setSelectionRange(caret[0], caret[1]); } catch { /* number */ } }
    }
  }
}
/** Re-renders live regions whose HTML changed (an unchanged one keeps its
 * nodes, so a button in it can't be replaced under the pointer). */
function refreshLive() {
  for (const el of $$("[data-live]")) {
    const fn = LIVE[el.dataset.live];
    if (!fn) continue;
    const html = fn();
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
  }
  drawLadders();
}
const live = (name, fn) => {
  LIVE[name] = fn;
  const html = fn();
  LIVE_HTML[name] = html;
  return `<div data-live="${name}" style="display:contents">${html}</div>`;
};
const LIVE_HTML = {};

/* ---------- Editor state ---------- */
function useEditor(key, init, opts = {}) {
  S.used = key;
  if (!ED || ED.key !== key) {
    const draft = init();
    ED = { key, draft, orig: clone(draft), touched: new Set(), submitted: false, validate: () => ({ E: {}, W: {} }), ...opts };
  }
  return ED;
}
const edDirty = () => !!ED && JSON.stringify(ED.draft) !== JSON.stringify(ED.orig);
const edCheck = () => (ED ? ED.validate(ED.draft) : { E: {}, W: {} });
const shown = (path) => ED && (ED.submitted || ED.touched.has(path));
function edMsg(path) {
  const { E, W } = edCheck();
  if (E[path] && shown(path)) return { err: E[path] };
  if (W[path]) return { warn: W[path] };
  return {};
}
/** Visible errors, optionally only those under a path prefix. */
function edErrors(prefix = "") {
  const { E } = edCheck();
  return Object.keys(E).filter((p) => p.startsWith(prefix) && shown(p));
}
function getPath(o, path) {
  let cur = o;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    if (seg.includes("#")) {
      const [arr, id] = seg.split("#");
      // leaf#id / node#id address a node anywhere in a rule's condition tree.
      cur = arr === "leaf" || arr === "node" ? findNode(cur.condition, id)[0] : (cur[arr] || []).find((x) => x.uid === id);
    } else cur = cur[seg];
  }
  return cur;
}
function setPath(o, path, val) {
  const segs = path.split(".");
  const last = segs.pop();
  const parent = segs.length ? getPath(o, segs.join(".")) : o;
  if (parent) parent[last] = val;
}
function savebar(label = "Save", extra = "") {
  const dirty = edDirty();
  const n = edErrors().length;
  const state = dirty ? (n ? `Unsaved changes · ${plural(n, "problem")} to fix` : "Unsaved changes") : ED?.isNew ? "Not created yet" : "All changes saved";
  return `<div class="savebar" role="region" aria-label="Save changes">
    <div class="state ${dirty ? "" : "clean"}" aria-live="polite"><span class="dot"></span><span class="trunc">${state}</span></div>
    ${extra}
    <button class="btn btn--ghost" data-act="ed-discard" ${dirty ? "" : "disabled"}>Discard</button>
    <button class="btn btn--primary" data-act="ed-save" ${dirty || ED?.isNew ? "" : "disabled"}>${esc(label)}</button>
  </div>`;
}
async function edSave() {
  const { E } = edCheck();
  if (Object.keys(E).length) {
    ED.submitted = true;
    ED.onInvalid?.(Object.keys(E));
    render();
    const first = $('#app [aria-invalid="true"]');
    if (first) first.focus();
    return;
  }
  const before = ED.orig;
  const ok = await ED.onSave(ED.draft, before);
  if (ok === false) return;
}

/* ---------- Field rendering ---------- */
const fid = (path) => "f-" + path.replace(/[^\w]/g, "-");
/** One Field: label above, control, one message line (hint, or the error/warning replacing it). */
function fld(o) {
  const path = o.path;
  const id = o.id || (path ? fid(path) : uid("f"));
  const v = o.value !== undefined ? o.value : path && ED ? getPath(ED.draft, path) : "";
  const m = path && ED ? edMsg(path) : {};
  const err = o.err || m.err;
  const warn = !err && (o.warn || m.warn);
  const msgId = id + "-m";
  const bind = path ? `data-bind="${path}"` : "";
  const t = o.type || "text";
  const dtype = o.num || t === "number" ? 'data-type="num"' : o.bool ? 'data-type="bool"' : "";
  const common = `id="${id}" ${bind} ${dtype} ${err ? 'aria-invalid="true"' : ""} aria-describedby="${msgId}" ${o.disabled ? "disabled" : ""} ${o.attrs || ""}`;
  let ctl;
  if (t === "select") {
    const groups = {};
    for (const op of o.options) (groups[op.g || ""] ||= []).push(op);
    const opts = Object.entries(groups)
      .map(([g, ops]) => {
        const inner = ops.map((op) => `<option value="${esc(op.v)}" ${String(op.v) === String(v ?? "") ? "selected" : ""} ${op.dis ? "disabled" : ""}>${esc(op.l)}</option>`).join("");
        return g ? `<optgroup label="${esc(g)}">${inner}</optgroup>` : inner;
      })
      .join("");
    ctl = `<select class="select" ${common}>${o.placeholder ? `<option value="" ${v == null || v === "" ? "selected" : ""} disabled>${esc(o.placeholder)}</option>` : ""}${opts}</select>`;
  } else if (t === "textarea") {
    ctl = `<textarea class="textarea" ${common} placeholder="${esc(o.placeholder || "")}">${esc(v ?? "")}</textarea>`;
  } else {
    ctl = `<input class="input ${o.mono ? "mono" : ""}" type="${t === "number" ? "number" : t}" ${t === "number" ? 'inputmode="decimal" step="any"' : ""} value="${esc(v ?? "")}" placeholder="${esc(o.placeholder || "")}" ${common}>`;
    if (o.affix) ctl = `<div class="affix">${ctl}<span>${esc(o.affix)}</span></div>`;
  }
  if (o.after) ctl = `<div class="row">${ctl}${o.after}</div>`;
  const dh = `data-hint="${esc(o.hint || "")}"`;
  const msg = err
    ? `<div class="msg-err" id="${msgId}" ${dh}>${ic("alert", 13)}<span>${esc(err)}</span></div>`
    : warn
      ? `<div class="msg-warn" id="${msgId}" ${dh}>${ic("warn", 13)}<span>${esc(warn)}</span></div>`
      : `<div class="hint" id="${msgId}" ${dh}>${o.hint || ""}</div>`;
  return `<div class="field ${o.cls || ""}"><label for="${id}">${o.label}${o.optional ? ' <span class="opt">optional</span>' : ""}${o.labelExtra || ""}</label>${ctl}${msg}</div>`;
}
/** A saved on/off setting: label above, switch + state word, hint below (DESIGN §5 Switch). */
function switchFld({ path, label, on = "Enabled", off = "Disabled", hint = "", hintOff = "" }) {
  const v = !!getPath(ED.draft, path);
  const id = fid(path);
  return `<div class="field"><span class="field-label" id="${id}-l">${label}</span>
    <label class="switch"><input type="checkbox" role="switch" id="${id}" data-bind="${path}" data-type="bool" aria-labelledby="${id}-l" ${v ? "checked" : ""}><span class="track"></span><span>${v ? on : off}</span></label>
    <div class="hint">${v ? hint : hintOff || hint}</div></div>`;
}
/** Mutually exclusive choice as a radiogroup that writes `path`. */
function seg(path, options, value, label = "") {
  const v = value !== undefined ? value : getPath(ED.draft, path);
  return `<div class="seg" role="radiogroup" ${label ? `aria-label="${esc(label)}"` : ""}>${options
    .map(([val, l]) => `<button type="button" role="radio" aria-checked="${String(val) === String(v)}" tabindex="${String(val) === String(v) ? 0 : -1}" data-act="set" data-path="${path}" data-val="${esc(val)}" data-vt="${typeof val}">${l}</button>`)
    .join("")}</div>`;
}

/* ---------- Overlays: sheet, dialog, menu, toast, palette ---------- */
const OV = [];
function pushOv(html, { onClose, cls = "" } = {}) {
  const ov = $("#ov");
  const el = document.createElement("div");
  el.className = "ov-layer " + cls;
  el.innerHTML = html;
  el.style.cssText = "position:absolute;inset:0";
  ov.appendChild(el);
  const ret = document.activeElement;
  OV.push({ el, onClose, ret });
  setTimeout(() => { if (!el.contains(document.activeElement)) (el.querySelector("[autofocus]") || el.querySelector("button, [href], input, select, textarea, [tabindex]"))?.focus(); }, 0);
  return el;
}
function popOv(result) {
  const top = OV.pop();
  if (!top) return;
  top.el.remove();
  top.onClose?.(result);
  if (top.ret && document.contains(top.ret)) top.ret.focus();
}
function closeAllOv() {
  while (OV.length) popOv();
}
function openSheet({ title, body, foot = "", bottom = false, sub = "", onClose, label }) {
  return pushOv(
    `<div class="scrim" data-act="ov-close"></div>
    <div class="sheet ${bottom ? "sheet--bottom" : ""}" role="dialog" aria-modal="true" aria-label="${esc(label || title)}">
      <div class="sheet-h"><div class="grow"><h2 class="trunc">${title}</h2>${sub ? `<div class="small muted">${sub}</div>` : ""}</div><button class="btn btn--icon" data-act="ov-close" aria-label="Close">${ic("x")}</button></div>
      <div class="sheet-b">${body}</div>${foot ? `<div class="sheet-f">${foot}</div>` : ""}
    </div>`,
    { onClose },
  );
}
function confirmDlg({ title, body, details = "", confirm = "Confirm", danger = true, cancel = "Cancel", alt = null }) {
  return new Promise((resolve) => {
    pushOv(
      `<div class="scrim" data-act="ov-close"></div><div class="dialog-wrap"><div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t">
        <h2 id="dlg-t">${title}</h2><p>${body}</p>${details}
        <div class="dialog-f"><button class="btn btn--secondary" data-act="ov-close" autofocus>${cancel}</button>${alt ? `<button class="btn btn--secondary" data-act="ov-result" data-r="alt">${alt}</button>` : ""}<button class="btn ${danger ? "btn--danger" : "btn--primary"}" data-act="ov-result" data-r="ok">${confirm}</button></div>
      </div></div>`,
      { onClose: (r) => resolve(r || false) },
    );
  });
}
function toast({ title, detail = "", tone = "", undo }) {
  let box = $("#ov .toasts");
  if (!box) {
    box = document.createElement("div");
    box.className = "toasts";
    box.setAttribute("aria-live", "polite");
    $("#ov").appendChild(box);
  }
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `${ic(tone === "error" ? "alert" : "check", 16, tone === "error" ? "icon-err" : "tone-online")}<div class="grow"><b>${esc(title)}</b>${detail ? `<div class="detail">${detail}</div>` : ""}</div>${undo ? `<button class="btn btn--link">Undo</button>` : ""}`;
  if (undo) t.querySelector("button").onclick = () => { undo(); t.remove(); render(); };
  box.appendChild(t);
  setTimeout(() => t.remove(), undo ? 7000 : 4500);
}
function openMenu(anchor, items) {
  closeMenu();
  const fr = $("#frame").getBoundingClientRect();
  const r = anchor.getBoundingClientRect();
  const m = document.createElement("div");
  m.className = "menu";
  m.setAttribute("role", "menu");
  m.innerHTML = items
    .map((it) => (it === "-" ? "<hr>" : `<button role="menuitem" tabindex="-1" class="${it.danger ? "danger" : ""}" data-act="${it.href ? "nav" : it.act || ""}" ${it.attrs || ""} ${it.href ? `data-href="${it.href}"` : ""}>${it.icon ? ic(it.icon, 15) : ""}<span>${esc(it.label)}</span>${it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : ""}</button>`))
    .join("");
  $("#ov").appendChild(m);
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = r.right - fr.left - mw;
  if (left < 8) left = Math.min(r.left - fr.left, fr.width - mw - 8);
  let top = r.bottom - fr.top + 4;
  if (top + mh > fr.height - 8) top = r.top - fr.top - mh - 4;
  m.style.left = Math.max(8, left) + "px";
  m.style.top = Math.max(8, top) + "px";
  S.menu = { el: m, anchor };
  anchor.setAttribute("aria-expanded", "true");
  m.querySelector("[role=menuitem]")?.focus();
}
function closeMenu(refocus = false) {
  if (!S.menu) return;
  S.menu.el.remove();
  S.menu.anchor.setAttribute("aria-expanded", "false");
  if (refocus) S.menu.anchor.focus();
  S.menu = null;
}
const menuBtn = (menuId, label = "More actions", args = "") => `<button class="btn btn--icon" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(label)}" data-act="menu" data-menu="${menuId}" ${args}>${ic("more")}</button>`;
const MENUS = {}; // id -> (el) => items

function openPalette() {
  const items = [
    ...["Dashboards", "Devices", "Notifications", "Rules", "Device templates", "Zones", "Members", "API keys", "Workspace settings"].map((l, i) => ({ l, h: ["#/dashboards", "#/devices", "#/notifications", "#/rules", "#/templates", "#/zones", "#/members", "#/keys", "#/settings"][i], g: "Go to" })),
    { l: "Add device", h: "#/devices/new", g: "Actions" },
    { l: "New rule", h: "#/rules/new", g: "Actions" },
    { l: "New device template", h: "#/templates/new", g: "Actions" },
    ...DEVICES.map((d) => ({ l: d.name, h: "#/devices/" + d.id, g: "Device" })),
    ...RULES.map((r) => ({ l: r.name, h: "#/rules/" + r.id, g: "Rule" })),
  ];
  const el = pushOv(`<div class="scrim" data-act="ov-close"></div><div class="palette" role="dialog" aria-modal="true" aria-label="Search or run a command"><input id="pal-in" placeholder="Search or run…" autofocus aria-controls="pal-list" autocomplete="off"><ul id="pal-list" role="listbox"></ul></div>`);
  const draw = (q) => {
    const list = items.filter((i) => i.l.toLowerCase().includes(q.toLowerCase())).slice(0, 12);
    $("#pal-list", el).innerHTML = list.length ? list.map((i, n) => `<li><a href="${i.h}" class="${n === 0 ? "on" : ""}" data-act="ov-nav">${esc(i.l)}<span class="pg">${i.g}</span></a></li>`).join("") : `<li class="empty">No matches</li>`;
  };
  draw("");
  const inp = $("#pal-in", el);
  inp.addEventListener("input", () => draw(inp.value));
  inp.addEventListener("keydown", (e) => {
    const links = $$("#pal-list a", el);
    const i = links.findIndex((a) => a.classList.contains("on"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = (i + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
      links.forEach((a, k) => a.classList.toggle("on", k === n));
      links[n]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && links[i]) {
      e.preventDefault();
      popOv();
      guardNav(links[i].getAttribute("href"));
    }
  });
}

/* ---------- Unsaved-changes guard ---------- */
async function guardNav(hash) {
  if (edDirty() && !ED.leaving) {
    const r = await confirmDlg({ title: "Leave without saving?", body: `You have unsaved changes in ${esc(ED.noun || "this editor")}. Leaving discards them.`, confirm: "Discard and leave", cancel: "Keep editing" });
    if (r !== "ok") return;
    ED.leaving = true;
  } else if (S.guard?.()) {
    // A page-level guard (e.g. a one-time secret not stored yet).
    const g = S.guard();
    const r = await confirmDlg({ title: g.title, body: g.body, confirm: g.confirm || "Leave anyway", cancel: "Stay" });
    if (r !== "ok") return;
    S.guard = null;
  }
  navigate(hash);
}

/* ---------- Actions (delegated) ---------- */
const ACT = {
  "ov-close": () => popOv(),
  "ov-result": (el) => popOv(el.dataset.r),
  "ov-nav": (el, e) => { e.preventDefault(); popOv(); guardNav(el.getAttribute("href")); },
  nav: (el) => guardNav(el.dataset.href),
  skip: () => $("#content")?.focus(),
  palette: () => openPalette(),
  theme: () => toggleTheme(),
  menu: (el) => (S.menu?.anchor === el ? closeMenu() : openMenu(el, MENUS[el.dataset.menu](el))),
  set: (el) => {
    let v = el.dataset.val;
    if (el.dataset.vt === "number") v = Number(v);
    if (el.dataset.vt === "boolean") v = v === "true";
    setPath(ED.draft, el.dataset.path, v);
    ED.onSet?.(el.dataset.path, v);
    render();
  },
  "ed-save": () => edSave(),
  "ed-discard": () => {
    ED.draft = clone(ED.orig);
    ED.touched.clear();
    ED.submitted = false;
    ED.onDiscard?.();
    render();
  },
  "range": (el) => { S.range = el.dataset.val; store.set("range", S.range); render(); },
};
function onClick(e) {
  if (S.menu && !S.menu.el.contains(e.target) && !S.menu.anchor.contains(e.target)) closeMenu();
  const a = e.target.closest("a[href^='#/']");
  if (a && !e.defaultPrevented && !a.closest("[data-act]")) {
    if ((edDirty() || S.guard?.()) && ($("#app").contains(a) || $("#ov").contains(a))) {
      e.preventDefault();
      guardNav(a.getAttribute("href"));
      return;
    }
    if (OV.length && $("#ov").contains(a)) closeAllOv();
  }
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  // An interactive element inside a clickable row keeps its own behaviour.
  const inner = e.target.closest("a, button, input, select, textarea, label");
  if (inner && inner !== el && el.contains(inner)) return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  if (el.closest(".menu")) closeMenu();
  if (el.type !== "checkbox") e.preventDefault();
  fn(el, e);
}
function onInput(e) {
  const el = e.target.closest("[data-bind]");
  if (!el || !ED || el.tagName === "SELECT" || el.type === "checkbox") return;
  writeBind(el);
  refreshLive();
}
const isTextLike = (el) => el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio"].includes(el.type));
function onChange(e) {
  const el = e.target.closest("[data-bind]");
  if (!el || !ED) return;
  writeBind(el);
  ED.touched.add(el.dataset.bind);
  // A text field's change fires on blur, often on the way to a click: patch
  // in place so the button under the pointer isn't replaced mid-click.
  if (isTextLike(el)) { patchField(el); refreshLive(); }
  else render();
}
function onFocusOut(e) {
  const el = e.target.closest?.("[data-bind]");
  if (!el || !ED || ED.touched.has(el.dataset.bind)) return;
  ED.touched.add(el.dataset.bind);
  patchField(el);
  refreshLive();
}
/** Re-renders one field's message line and invalid state from the draft. */
function patchField(el) {
  const msg = document.getElementById(el.id + "-m");
  if (!msg) return;
  const m = edMsg(el.dataset.bind);
  const hint = msg.dataset.hint || "";
  if (m.err) el.setAttribute("aria-invalid", "true");
  else el.removeAttribute("aria-invalid");
  msg.className = m.err ? "msg-err" : m.warn ? "msg-warn" : "hint";
  msg.innerHTML = m.err ? `${ic("alert", 13)}<span>${esc(m.err)}</span>` : m.warn ? `${ic("warn", 13)}<span>${esc(m.warn)}</span>` : hint;
}
function writeBind(el) {
  const path = el.dataset.bind;
  let v = el.type === "checkbox" ? el.checked : el.value;
  if (el.dataset.type === "num") v = v === "" ? null : Number(v);
  if (el.dataset.type === "bool" && el.type !== "checkbox") v = v === "true";
  setPath(ED.draft, path, v);
  ED.onSet?.(path, v, el);
}
function onKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
  if (e.key === "Escape") {
    if (S.menu) return closeMenu(true);
    if (OV.length) return popOv();
  }
  if (S.menu && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End")) {
    e.preventDefault();
    const items = $$("[role=menuitem]", S.menu.el);
    let i = items.indexOf(document.activeElement);
    i = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[i].focus();
    return;
  }
  const t = e.target;
  // Ladder elements: Enter/Space opens, arrow keys move between elements.
  if (t.dataset?.lad) {
    if ((e.key === "Enter" || e.key === " ") && t.tagName !== "BUTTON") { e.preventDefault(); t.dispatchEvent(new MouseEvent("click", { bubbles: true })); return; }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      const all = $$("[data-lad]", t.closest("[data-ladder]"));
      const i = all.indexOf(t);
      all[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
      e.preventDefault();
      return;
    }
  }
  // Tabs and radiogroups: arrow keys move and select.
  if ((t.getAttribute?.("role") === "tab" || t.getAttribute?.("role") === "radio") && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
    const group = t.closest('[role="tablist"], [role="radiogroup"]');
    const items = $$(`[role="${t.getAttribute("role")}"]`, group);
    const i = items.indexOf(t);
    const n = items[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    e.preventDefault();
    const id = n.id;
    n.click();
    setTimeout(() => (id ? document.getElementById(id) : null)?.focus(), 0);
    return;
  }
  if (OV.length && e.key === "Tab") {
    const layer = OV[OV.length - 1].el;
    const f = $$("button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])", layer).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
  // A non-button element acting as a button (alarm rows, editable widgets).
  if ((e.key === "Enter" || e.key === " ") && t.getAttribute?.("role") === "button" && t.tagName !== "BUTTON" && t.dataset?.act && !t.dataset.lad) { e.preventDefault(); t.click(); return; }
  if (e.key === "Enter" && t.tagName === "TR") { if (t.dataset.peek) ACT.peek(t); else if (t.dataset.href) guardNav(t.dataset.href); }
}

/* ---------- Theme ---------- */
function applyTheme() {
  const t = store.get("theme");
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}
function toggleTheme() {
  store.set("theme", isDark() ? "light" : "dark");
  applyTheme();
  render();
}

/* ---------- Charts (inline SVG, 24 h axis, sliding window) ---------- */
const RANGES = { "1m": MIN, "10m": 10 * MIN, "1h": HOUR, "6h": 6 * HOUR, "24h": DAY, "7d": 7 * DAY };
const SIG = {
  "d1:temperature": { base: 28.6, amp: 2.4, per: 5 * HOUR, noise: 0.35 }, "d1:humidity": { base: 62, amp: 5, per: 90 * MIN, noise: 1 },
  "d1:soil_moisture": { base: 42, amp: 3, per: 6 * HOUR, noise: 0.5, until: NOW - 12 * MIN },
  "d2:temperature": { base: 27, amp: 1.5, per: 70 * MIN, noise: 0.3 }, "d2:humidity": { base: 57, amp: 4, per: 80 * MIN, noise: 1 },
  "d7:flow": { base: 12, amp: 1.2, per: 20 * MIN, noise: 0.3 }, "d9:temperature": { base: -18, amp: 0.8, per: 40 * MIN, noise: 0.2 },
  "d9:door": { bool: true, per: 3 * HOUR }, "d3:door": { bool: true, per: 5 * HOUR }, "d3:light": { base: 300, amp: 120, per: DAY, noise: 10 },
  "d8:accel_z": { base: 0.99, amp: 0.02, per: 5 * MIN, noise: 0.01 }, "d8:accel_x": { base: 0.02, amp: 0.02, per: 7 * MIN, noise: 0.01 }, "d8:accel_y": { base: -0.01, amp: 0.02, per: 9 * MIN, noise: 0.01 },
};
const rnd = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
function sample(dev, key, t) {
  const s = SIG[dev + ":" + key] || { base: 20, amp: 2, per: HOUR, noise: 0.3 };
  if (s.bool) return Math.sin((t / s.per) * 2 * Math.PI) > 0.85 ? 1 : 0;
  const wob = Math.sin(t / 37e3 + key.length) * 0.5 + Math.sin(t / 113e3 + 1.7) * 0.35 + Math.sin(t / 9e3) * 0.15;
  return s.base + s.amp * Math.sin((t / s.per) * 2 * Math.PI) + wob * s.noise * 1.6;
}
/** Placeholder; drawn after render at its real width so text never scales. */
function chartHtml(id, o) {
  CHARTS[id] = o;
  const agg = o.range === "7d" ? " · 1-hour averages" : o.range === "6h" || o.range === "24h" ? " · 1-minute averages" : "";
  return `<div class="chart" data-chart="${id}" role="img" aria-label="${esc(o.label)}"></div><div class="chart-note">24-hour times, ${esc(TZ)}${agg}</div>`;
}
function drawCharts() {
  for (const el of $$("[data-chart]")) {
    const o = CHARTS[el.dataset.chart];
    if (o) el.innerHTML = chartSvg(o, Math.max(240, el.clientWidth || 600));
  }
}
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= n) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
function chartSvg(o, W) {
  const H = o.h || (W < 480 ? 170 : 210);
  const pl = 44, pr = 14, pt = 10, pb = 24;
  const to = Date.now(), span = RANGES[o.range], from = to - span;
  const n = Math.min(180, Math.max(40, Math.floor(W / 4)));
  const stepT = span / n;
  const s = SIG[o.dev + ":" + o.key] || {};
  const until = Math.min(o.until ?? to, s.until ?? to);
  const pts = [];
  if (!o.never) for (let i = 0; i <= n; i++) { const t = from + i * stepT; if (t > until) break; pts.push([t, sample(o.dev, o.key, t)]); }
  const X = (t) => pl + ((t - from) / span) * (W - pl - pr);
  let lo, hi, yt, ylab;
  if (o.bool) { lo = -0.2; hi = 1.2; yt = [0, 1]; ylab = (v) => (v ? "On" : "Off"); }
  else {
    const vals = pts.map((p) => p[1]).concat(o.threshold != null ? [o.threshold] : []);
    lo = vals.length ? Math.min(...vals) : 0; hi = vals.length ? Math.max(...vals) : 1;
    const pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad;
    yt = niceTicks(lo, hi); ylab = (v) => +v.toFixed(2);
  }
  const Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  const gid = "g" + o.dev + o.key + W;
  let line = "";
  pts.forEach(([t, v], i) => {
    if (o.bool) line += i ? `H${X(t).toFixed(1)}V${Y(v).toFixed(1)}` : `M${X(t).toFixed(1)},${Y(v).toFixed(1)}`;
    else line += (i ? "L" : "M") + X(t).toFixed(1) + "," + Y(v).toFixed(1);
  });
  const area = pts.length ? `${line}V${Y(o.bool ? 0 : lo)}H${X(pts[0][0]).toFixed(1)}Z` : "";
  const xt = [];
  for (let i = 0; i <= 4; i++) xt.push(from + (span * i) / 4);
  const xl = (t) => (o.range === "7d" ? dayLabel(new Date(t)).split(" ").slice(0, 2).join(" ") :o.range === "1m" ? F_TIME_S.format(new Date(t)) : F_TIME.format(new Date(t)));
  const th = o.threshold != null && !o.bool ? `<line x1="${pl}" x2="${W - pr}" y1="${Y(o.threshold)}" y2="${Y(o.threshold)}" stroke="var(--color-status-pending)" stroke-dasharray="4 4" stroke-width="1.2"/><text x="${W - pr}" y="${Y(o.threshold) - 5}" text-anchor="end" style="font-size:11px;fill:var(--color-status-pending)">${o.threshold} ${esc(o.unit || "")}</text>` : "";
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--color-chart)" stop-opacity=".18"/><stop offset="1" stop-color="var(--color-chart)" stop-opacity="0"/></linearGradient></defs>
    <g class="grid">${yt.map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/>`).join("")}</g>
    <g class="axis">${yt.map((v) => `<text x="${pl - 8}" y="${Y(v) + 4}" text-anchor="end">${ylab(v)}</text>`).join("")}
    ${xt.map((t, i) => `<text x="${X(t)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}">${xl(t)}</text>`).join("")}</g>
    ${area ? `<path d="${area}" fill="url(#${gid})"/>` : ""}
    ${line ? `<path d="${line}" fill="none" stroke="var(--color-chart)" stroke-width="1.8" stroke-linejoin="round"/>` : ""}
    ${th}
    ${!pts.length ? `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" style="font-size:13px;fill:var(--color-ink-muted)">No readings in the last ${o.range}</text>` : ""}
  </svg>`;
}
const rangeSeg = (cur) => `<div class="seg" role="radiogroup" aria-label="Time range">${Object.keys(RANGES).map((r) => `<button role="radio" aria-checked="${r === cur}" tabindex="${r === cur ? 0 : -1}" data-act="range" data-val="${r}">${r}</button>`).join("")}</div>`;

/* ---------- Simulated live data ---------- */
function tick() {
  for (const el of $$("[data-ago]")) el.textContent = ago(+el.dataset.ago);
}
function liveData() {
  if (S.offline) return;
  const t = Date.now();
  for (const d of DEVICES) {
    if (d.status !== "online") continue;
    d.seen = t - 1000 * Math.floor(rnd(t) * 3);
    const r = READINGS[d.id] || {};
    for (const k in r) {
      const s = SIG[d.id + ":" + k];
      if (!s || s.until || r[k][0] == null) continue;
      r[k] = [s.bool ? !!sample(d.id, k, t) : sample(d.id, k, t), t];
    }
  }
  for (const el of $$("[data-readout]")) {
    const [dev, key] = el.dataset.readout.split(":");
    const m = metricOf(devById(dev), key);
    const v = READINGS[dev]?.[key];
    if (v && v[0] != null) el.firstChild.nodeValue = fmtReading(m, v[0]);
  }
  for (const el of $$("[data-seen]")) { const d = devById(el.dataset.seen); if (d?.seen) el.innerHTML = agoEl(d.seen); }
  const short = ["1m", "10m", "1h"].includes(S.range || "10m");
  if (short) drawCharts();
}

/* ---------- Harness and boot ---------- */
const WIDTHS = ["fit", 1440, 1366, 1280, 1150, 820, 390];
function setWidth(w) {
  const st = $(".hz-stage");
  st.dataset.w = w;
  $("#frame").style.width = w === "fit" ? "100%" : w + "px";
  $$("[data-hz-w]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hzW === String(w))));
  store.set("w", w);
  setTimeout(drawCharts, 30);
}
function boot(routes) {
  ROUTES = routes;
  S.range = store.get("range") || "10m";
  applyTheme();
  document.title = DEMO.title;
  document.body.innerHTML = `<div class="hz">
    <div class="hz-bar" role="toolbar" aria-label="Demo controls">
      <b>${esc(DEMO.name)}</b><span class="muted">Width</span>
      ${WIDTHS.map((w) => `<button data-hz-w="${w}">${w === "fit" ? "Fit" : w}</button>`).join("")}
      <span class="sep"></span><button data-hz-theme>Light / dark</button>
      <button data-hz-net aria-pressed="false">Simulate disconnect</button>
      <span class="sep"></span><a href="index.html">About this demo</a>
    </div>
    <div class="hz-stage"><div class="frame" id="frame"><div class="app" id="app"></div><div class="overlays" id="ov"></div></div></div>
  </div>`;
  $(".hz-bar").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.hzW) setWidth(b.dataset.hzW === "fit" ? "fit" : +b.dataset.hzW);
    if ("hzTheme" in b.dataset) toggleTheme();
    if ("hzNet" in b.dataset) { S.offline = !S.offline; b.setAttribute("aria-pressed", String(S.offline)); render(); }
  });
  const w = store.get("w");
  setWidth(w && w !== "fit" ? +w : "fit");
  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("change", onChange);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("keydown", onKey);
  window.addEventListener("hashchange", () => { closeAllOv(); closeMenu(); render(); });
  new ResizeObserver(() => { drawCharts(); drawLadders(); }).observe($("#frame"));
  setInterval(tick, 1000);
  setInterval(liveData, 3000);
  render();
}
/** Page-level stale-data banner (shown while the live connection is down). */
const netBanner = () => (S.offline ? `<div class="banner" role="status"><span class="tone-pending">${ic("wifi", 15)}</span><span><b>Reconnecting…</b> Live updates are paused, so values on this page may be stale.</span></div>` : "");
const liveInd = () => `<span class="live-ind ${S.offline ? "off" : ""}"><span class="dot"></span>${S.offline ? "Reconnecting…" : "Live updates on"}</span>`;
