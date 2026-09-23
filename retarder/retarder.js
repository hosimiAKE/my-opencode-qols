/*retarder:v2 — OpenCode Desktop 定时发送插件：默认不生效；定时按会话独立保存。*/
(function () {
  "use strict";
  if (window.__opencodeRetarder) return;
  window.__opencodeRetarder = true;
  var SEND = '[data-action="composer-submit"]';
  var ALT = '[data-action="composer-alternate-delivery"]';
  var SHELL = '[data-action="composer-exit-shell"]';
  var FORM = 'form[data-component="composer"]';
  var EDITOR = '[data-component="composer-editor"]';
  var ACTIONS = '[data-slot="composer-actions"]';
  var ANCHOR = "data-rd-a";
  var KEY = "opencode.rd.v2";
  var ZH = {
    control: "定时发送", on: "定时发送：将在 {t} 发送", held: "消息待到点发送 · {t}", title: "定时发送",
    desc: "选择时间后，本会话发送的消息会等到该时间再发出。", off: "当前会话：未开启",
    on2: "当前会话：将在 {t} 发送", held2: "消息已暂存，将于 {t} 自动发送", in5: "5 分钟后",
    in30: "30 分钟后", in60: "1 小时后",
    date: "日期", time: "时间", confirm: "确定",
    cancel: "取消定时", sendNow: "立即发送", invalid: "请选择将来的时间",
  };
  var EN = {
    control: "Scheduled send", on: "Scheduled send: {t}", held: "Holding until {t}", title: "Scheduled send",
    desc: "Messages wait until the selected time.", off: "Off",
    on2: "Scheduled for {t}", held2: "Will send at {t}", in5: "In 5 min",
    in30: "In 30 min", in60: "In 1 hour",
    date: "Date", time: "Time", confirm: "OK",
    cancel: "Cancel", sendNow: "Send now", invalid: "Pick a future time",
  };
  var IS_ZH = (navigator.language || "en").toLowerCase().indexOf("zh") === 0;
  var D = IS_ZH ? ZH : EN;
  function t(k, v) {
    var s = D[k] || k;
    if (v) for (var i in v) s = s.split("{" + i + "}").join(v[i]);
    return s;
  }
  var targets = {};      // 会话 key -> 时刻
  var held = null;       // { key, btn, target, deadline }
  var sendTimer = null, tick = null, retry = null, scheduled = false;
  var pop = null, popOwner = null, seen = [];
  var formKeys = typeof WeakMap === "function" ? new WeakMap() : null;

  /* ------------------------------------------------------------- 会话标识 */
  function currentKey() {
    try {
      var p = location.pathname || "/";
      var m = /\/session\/([^/?#]+)\/?$/.exec(p);
      if (m) return "s:" + m[1];
      if (p.indexOf("/new-session") === 0) {
        var d = new URLSearchParams(location.search || "").get("draftId");
        return d ? "d:" + d : "home";
      }
      return p === "/" ? "home" : p.replace(/\/+$/, "");
    } catch (e) {
      return "home";
    }
  }
  function keyOf(form) {
    if (!form) return currentKey();
    try {
      var r = form.getBoundingClientRect();
      var visible = !!(r.width && r.height);
      var k = formKeys ? formKeys.get(form) : undefined;
      if (visible || k === undefined) {
        // 可见的输入框始终对应当前会话；不可见的输入框不继承当前会话的定时
        k = visible ? currentKey() : "";
        if (formKeys) formKeys.set(form, k);
      }
      return k;
    } catch (e) {
      return currentKey();
    }
  }
  function targetOf(key) {
    var ts = targets[key];
    return ts && ts > Date.now() ? ts : 0;
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var now = Date.now();
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.targets) for (var k in s.targets) if (typeof s.targets[k] === "number" && s.targets[k] > now) targets[k] = s.targets[k];
      }
      localStorage.removeItem("opencode.retarder.v1");
    } catch (e) {}
  }
  function save() {
    try {
      var out = {}, now = Date.now(), n = 0;
      for (var k in targets) if (targets[k] > now) { out[k] = targets[k]; n++; }
      if (n) localStorage.setItem(KEY, JSON.stringify({ targets: out }));
      else localStorage.removeItem(KEY);
    } catch (e) {}
  }
  function clearSchedule(key) {
    delete targets[key];
    if (held && held.key === key) held = null;
    clearTimers();
    save();
    refresh();
  }

  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function hhmm(ts) { var d = new Date(ts); return p2(d.getHours()) + ":" + p2(d.getMinutes()); }
  function left(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + (IS_ZH ? " 秒" : "s");
    var m = Math.round(s / 60);
    if (m < 60) return m + (IS_ZH ? " 分钟" : " min");
    var h = Math.floor(m / 60), r = m % 60;
    return h + (IS_ZH ? " 小时" : " h") + (r ? " " + r + (IS_ZH ? " 分" : " min") : "");
  }
  var CSS = [
    "[" + ANCHOR + "]{position:relative;display:inline-flex;align-items:center;flex:none}",
    "[" + ANCHOR + "] [data-rd-c]{gap:5px;padding:0 8px}",
    "[" + ANCHOR + "] [data-rd-n]{font-size:12px;font-weight:530;font-variant-numeric:tabular-nums;letter-spacing:-.04px;line-height:1}",
    "[" + ANCHOR + "][data-armed] [data-rd-c]{background-color:var(--v2-background-bg-layer-02);color:var(--v2-text-text-base);box-shadow:inset 0 0 0 1px var(--v2-border-border-muted)}",
    "[" + ANCHOR + "][data-armed] [data-rd-c] [data-slot=icon-svg]{color:var(--v2-icon-icon-base)}",
    "[" + ANCHOR + "][data-held] [data-rd-c]{background-color:var(--v2-overlay-simple-overlay-pressed)}",
    "[data-rd-d]{width:5px;height:5px;border-radius:999px;background:currentColor;animation:rd-pulse 1.4s ease-in-out infinite}",
    "@keyframes rd-pulse{0%,100%{opacity:.25}50%{opacity:1}}",
    "[data-rd-p]{position:fixed;z-index:2147483000;width:252px;padding:8px;border-radius:10px;background:var(--v2-background-bg-layer-01);border:1px solid var(--v2-border-border-muted);box-shadow:var(--v2-elevation-overlay);color:var(--v2-text-text-base);font-family:var(--v2-font-family-sans,Inter,sans-serif);font-size:13px;font-weight:440;letter-spacing:-.04px;line-height:20px;box-sizing:border-box}",
    "[data-rd-p] *{box-sizing:border-box}",
    "[data-rd-p] .rd-head{font-weight:530;padding:4px 8px 2px}",
    "[data-rd-p] .rd-desc{color:var(--v2-text-text-muted);padding:0 8px 8px;font-size:12px;line-height:17px}",
    "[data-rd-p] .rd-desc.rd-strong{color:var(--v2-text-text-base)}",
    "[data-rd-p] .rd-list{display:flex;flex-direction:column;gap:2px}",
    "[data-rd-p] .rd-btn{display:flex;align-items:center;gap:8px;width:100%;height:28px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--v2-text-text-base);font:inherit;text-align:left;cursor:pointer}",
    "[data-rd-p] .rd-btn:hover{background-color:var(--v2-overlay-simple-overlay-hover)}",
    "[data-rd-p] .rd-btn .rd-k{color:var(--v2-text-text-faint);font-size:12px}",
    "[data-rd-p] .rd-row{display:flex;align-items:center;gap:6px;padding:2px 8px 4px}",
    "[data-rd-p] input{flex:1;min-width:0;height:28px;padding:0 7px;border:1px solid var(--v2-border-border-muted);border-radius:6px;background:var(--v2-background-bg-base);color:var(--v2-text-text-base);font:inherit;outline:none}",
    "[data-rd-p] input:focus{border-color:var(--v2-border-border-focus,var(--v2-border-border-strong))}",
    "[data-rd-p] .rd-ok{height:28px;padding:0 10px;border:0;border-radius:6px;background:var(--v2-background-bg-button-neutral);color:var(--v2-text-text-base);box-shadow:var(--v2-elevation-button-neutral);font:inherit;font-weight:530;cursor:pointer}",
    "[data-rd-p] .rd-sep{height:1px;margin:6px 4px;background:var(--v2-border-border-muted)}",
    "[data-rd-p] .rd-foot{color:var(--v2-text-text-faint);font-size:12px;padding:2px 8px 4px}",
    ":root[data-color-scheme=dark] [data-rd-p]{color-scheme:dark}",
    ":root[data-color-scheme=light] [data-rd-p]{color-scheme:light}",
  ].join("\n");
  function injectCss() {
    if (document.getElementById("rd-style")) return;
    var s = document.createElement("style");
    s.id = "rd-style";
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    if (text != null) n.textContent = text;
    return n;
  }
  function icon() {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("data-slot", "icon-svg");
    s.setAttribute("width", "16");
    s.setAttribute("height", "16");
    s.setAttribute("viewBox", "0 0 20 20");
    s.setAttribute("fill", "none");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = '<path d="M10 2.75C5.99594 2.75 2.75 5.99594 2.75 10C2.75 14.0041 5.99594 17.25 10 17.25C14.0041 17.25 17.25 14.0041 17.25 10C17.25 5.99594 14.0041 2.75 10 2.75Z" stroke="currentColor"/><path d="M10 5.5V10.25L13.25 12" stroke="currentColor" stroke-linecap="square"/>';
    return s;
  }
  function buildAnchor() {
    var a = document.createElement("span");
    a.setAttribute(ANCHOR, "");
    var b = el("button", { type: "button", "data-component": "button-v2", "data-variant": "ghost-faint", "data-size": "small", "data-icon": "", "data-rd-c": "", "aria-haspopup": "dialog" });
    var dot = el("span", { "data-rd-d": "" });
    var label = el("span", { "data-rd-n": "" });
    dot.hidden = true;
    label.hidden = true;
    b.appendChild(icon());
    b.appendChild(dot);
    b.appendChild(label);
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); toggle(a, b); });
    a.appendChild(b);
    return a;
  }

  /* ------------------------------------------------------------------ DOM */
  function decorate() {
    var forms = document.querySelectorAll(FORM);
    for (var i = 0; i < forms.length; i++) {
      var anchors = forms[i].querySelectorAll("[" + ANCHOR + "]");
      for (var j = 1; j < anchors.length; j++) if (anchors[j].parentNode) anchors[j].parentNode.removeChild(anchors[j]);
      if (anchors[0] && !forms[i].querySelector(SEND) && anchors[0].parentNode) anchors[0].parentNode.removeChild(anchors[0]);
    }
    var list = document.querySelectorAll(SEND);
    var next = [];
    for (var k = 0; k < list.length; k++) {
      var btn = list[k];
      var form = btn.closest(FORM);
      if (!form) continue;
      var host = form.querySelector(ACTIONS) || btn.parentElement;
      if (!host) continue;
      var at = btn;
      while (at.parentElement && at.parentElement !== host) at = at.parentElement;
      var anchor = form.querySelector("[" + ANCHOR + "]");
      if (!anchor) {
        anchor = buildAnchor();
        try { host.insertBefore(anchor, at); } catch (e) { continue; }
      } else if (anchor.parentElement !== host || anchor.nextElementSibling !== at) {
        try { host.insertBefore(anchor, at); } catch (e) {}
      }
      next.push({ a: anchor, b: btn });
    }
    seen = next;
  }
  function refresh() {
    var now = Date.now(), active = false;
    seen = seen.filter(function (s) { return s.a.isConnected && s.b.isConnected; });
    for (var i = 0; i < seen.length; i++) {
      var a = seen[i].a, btn = a.firstChild;
      var label = a.querySelector("[data-rd-n]");
      var dot = a.querySelector("[data-rd-d]");
      var key = keyOf(a.closest(FORM));
      var ts = targetOf(key);
      var isHeld = !!held && held.key === key;
      if (isHeld) ts = held.target;
      if (ts > now) {
        active = true;
        a.setAttribute("data-armed", "");
        label.hidden = false;
        label.textContent = hhmm(ts);
        dot.hidden = !isHeld;
        btn.title = t(isHeld ? "held" : "on", { t: hhmm(ts) });
        btn.setAttribute("aria-label", btn.title + " · " + left(ts - now));
      } else {
        a.removeAttribute("data-armed");
        label.hidden = true;
        label.textContent = "";
        dot.hidden = true;
        btn.title = t("control");
        btn.setAttribute("aria-label", t("control"));
      }
      if (isHeld) a.setAttribute("data-held", "");
      else a.removeAttribute("data-held");
    }
    if (active || held) tickOn(); else tickOff();
  }
  function tickOn() { if (!tick) tick = setInterval(refresh, 1000); }
  function tickOff() { if (tick) { clearInterval(tick); tick = null; } }
  function clearTimers() {
    if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
    if (retry) { clearTimeout(retry); retry = null; }
  }

  /* ----------------------------------------------------------------- 定时 */
  function arm(a, ts) {
    var key = keyOf(a.closest(FORM));
    targets[key] = ts;
    save();
    clearTimers();
    refresh();
    closePop();
  }
  function disarm(a) {
    var key = a ? keyOf(a.closest(FORM)) : held && held.key;
    if (key) clearSchedule(key);
    closePop();
  }
  function hold(btn, key) {
    if (held) return;
    held = { key: key, btn: btn, target: targets[key], deadline: 0 };
    refresh();
    clearTimers();
    var d = Math.max(0, Math.min(held.target - Date.now(), 2147483000));
    sendTimer = setTimeout(sendNow, d);
    tickOn();
  }
  function ok(btn) {
    if (!btn || !btn.isConnected || btn.disabled) return false;
    var r = btn.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    if (btn.querySelector("svg rect")) return false;
    var f = btn.closest(FORM);
    if (!f || f.querySelector(SHELL)) return false;
    return true;
  }
  function pickFor(key) {
    if (held && held.btn && ok(held.btn) && keyOf(held.btn.closest(FORM)) === key) return held.btn;
    var l = document.querySelectorAll(SEND);
    for (var i = l.length - 1; i >= 0; i--) {
      var btn = l[i];
      if (ok(btn) && keyOf(btn.closest(FORM)) === key) return btn;
    }
    return null;
  }
  function sendNow() {
    if (!held) return;
    var h = held;
    var btn = pickFor(h.key);
    if (!btn) {
      if (!h.deadline) h.deadline = Date.now() + 60000;
      if (Date.now() > h.deadline) { clearSchedule(h.key); return; }
      retry = setTimeout(sendNow, 2000);
      return;
    }
    var b = btn;
    delete targets[h.key];
    held = null;
    clearTimers();
    save();
    refresh();
    try { b.click(); } catch (e) {}
    setTimeout(function () {
      // 若这次点击没有生效（输入框仍有内容），再补一次，避免重复发送
      var form = b.closest(FORM), ed = form && form.querySelector(EDITOR);
      var text = ed && ed.textContent ? ed.textContent.trim() : "";
      if (b.isConnected && !b.disabled && text && !b.querySelector("svg rect")) {
        try { b.click(); } catch (e) {}
      }
    }, 600);
  }

  /* --------------------------------------------------------------- 拦截 */
  function onClick(e) {
    try {
      if (held) return;
      var x = e.target;
      if (!x || !x.closest) return;
      var btn = x.closest(SEND) || x.closest(ALT);
      if (!btn || btn.disabled || btn.querySelector("svg rect")) return;
      var f = btn.closest(FORM);
      if (!f || f.querySelector(SHELL)) return;
      var key = keyOf(f);
      if (!targetOf(key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      hold(f.querySelector(SEND) || btn, key);
    } catch (err) {}
  }
  function onKey(e) {
    try {
      if (held) return;
      if (e.key !== "Enter" || e.altKey || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      var x = e.target;
      if (!x || !x.closest) return;
      var ed = x.closest(EDITOR);
      if (!ed) return;
      var f = ed.closest(FORM);
      if (!f || f.querySelector(SHELL) || f.querySelector("[data-suggestion-id]")) return;
      var btn = f.querySelector(SEND);
      if (!btn || btn.disabled || btn.querySelector("svg rect")) return;
      var key = keyOf(f);
      if (!targetOf(key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      hold(btn, key);
    } catch (err) {}
  }

  /* --------------------------------------------------------------- 面板 */
  function quickBtn(label, hint, fn) {
    var b = el("button", { class: "rd-btn", type: "button" });
    b.appendChild(el("span", {}, label));
    if (hint) b.appendChild(el("span", { class: "rd-k" }, hint));
    b.addEventListener("click", function (e) { e.preventDefault(); fn(); });
    return b;
  }
  function dayAt(h) {
    var d = new Date(), tmr = 0;
    d.setHours(h, 0, 0, 0);
    if (d.getTime() <= Date.now()) { d.setDate(d.getDate() + 1); tmr = 1; }
    return { ts: d.getTime(), label: (tmr ? (IS_ZH ? "明天 " : "Tomorrow ") : (IS_ZH ? "今天 " : "Today ")) + h + ":00" };
  }
  function closePop() {
    if (!pop) return;
    if (pop.parentNode) pop.parentNode.removeChild(pop);
    pop = null;
    popOwner = null;
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("keydown", onDocKey, true);
    window.removeEventListener("resize", place, true);
  }
  function onDocDown(e) {
    if (!pop) return;
    if (pop.contains(e.target)) return;
    if (popOwner && popOwner.a.contains(e.target)) return;
    closePop();
  }
  function onDocKey(e) {
    if (e.key === "Escape" && pop) { e.preventDefault(); e.stopPropagation(); closePop(); }
  }
  function place() {
    if (!pop || !popOwner) return;
    var r = popOwner.b.getBoundingClientRect();
    var w = pop.offsetWidth || 252, h = pop.offsetHeight || 240;
    var left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    var top = r.top - h - 8;
    if (top < 8) top = Math.min(window.innerHeight - h - 8, r.bottom + 8);
    pop.style.left = left + "px";
    pop.style.top = Math.max(8, top) + "px";
  }
  function toggle(a, b) {
    if (pop && popOwner && popOwner.a === a) { closePop(); return; }
    closePop();
    var key = keyOf(a.closest(FORM));
    var ts = targetOf(key);
    var isHeld = !!held && held.key === key;
    var p = el("div", { "data-rd-p": "" });
    p.appendChild(el("div", { class: "rd-head" }, t("title")));
    p.appendChild(el("div", { class: "rd-desc" }, t("desc")));
    if (isHeld) p.appendChild(el("div", { class: "rd-desc rd-strong" }, t("held2", { t: hhmm(held.target) })));
    var list = el("div", { class: "rd-list" });
    list.appendChild(quickBtn(t("in5"), hhmm(Date.now() + 300000), function () { arm(a, Date.now() + 300000); }));
    list.appendChild(quickBtn(t("in30"), hhmm(Date.now() + 1800000), function () { arm(a, Date.now() + 1800000); }));
    list.appendChild(quickBtn(t("in60"), hhmm(Date.now() + 3600000), function () { arm(a, Date.now() + 3600000); }));
    [12, 18].forEach(function (h) {
      var q = dayAt(h);
      list.appendChild(quickBtn(q.label, "", function () { arm(a, q.ts); }));
    });
    p.appendChild(list);
    var row = el("div", { class: "rd-row" });
    var date = el("input", { type: "date", "aria-label": t("date") });
    var time = el("input", { type: "time", "aria-label": t("time") });
    var base = ts > Date.now() ? new Date(ts) : new Date(Date.now() + 1800000);
    date.value = base.getFullYear() + "-" + p2(base.getMonth() + 1) + "-" + p2(base.getDate());
    time.value = p2(base.getHours()) + ":" + p2(base.getMinutes());
    row.appendChild(date);
    row.appendChild(time);
    p.appendChild(row);
    var row2 = el("div", { class: "rd-row" });
    var okBtn = el("button", { class: "rd-ok", type: "button" }, t("confirm"));
    okBtn.addEventListener("click", function (e) {
      e.preventDefault();
      var v = new Date(date.value + "T" + (time.value || "00:00") + ":00").getTime();
      if (!v || isNaN(v) || v <= Date.now()) {
        okBtn.textContent = t("invalid");
        setTimeout(function () { okBtn.textContent = t("confirm"); }, 1400);
        return;
      }
      arm(a, v);
    });
    row2.appendChild(okBtn);
    p.appendChild(row2);
    p.appendChild(el("div", { class: "rd-sep" }));
    var foot = el("div", { class: "rd-list" });
    if (isHeld) foot.appendChild(quickBtn(t("sendNow"), hhmm(held.target), function () { sendNow(); }));
    if (ts > Date.now()) foot.appendChild(quickBtn(t("cancel"), "", function () { disarm(a); }));
    else p.appendChild(el("div", { class: "rd-foot" }, t("off")));
    p.appendChild(foot);
    (document.body || document.documentElement).appendChild(p);
    pop = p;
    popOwner = { a: a, b: b };
    place();
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onDocKey, true);
    window.addEventListener("resize", place, true);
  }

  /* ---------------------------------------------------------------- 启动 */
  function onRoute() {
    setTimeout(function () { try { decorate(); refresh(); } catch (e) {} }, 0);
  }
  function boot() {
    try {
      injectCss();
      load();
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("popstate", onRoute);
      var ps = history.pushState, rs = history.replaceState;
      history.pushState = function () { var r = ps.apply(this, arguments); onRoute(); return r; };
      history.replaceState = function () { var r = rs.apply(this, arguments); onRoute(); return r; };
      var run = function () { scheduled = false; try { decorate(); refresh(); } catch (e) {} };
      new MutationObserver(function () {
        if (scheduled) return;
        scheduled = true;
        setTimeout(run, 250);
      }).observe(document.documentElement, { childList: true, subtree: true });
      decorate();
      refresh();
      if (held || Object.keys(targets).length) tickOn();
    } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
