/*oc-betterui:v1 — OpenCode Desktop：会话列表按项目分组 + 标题栏菜单栏。*/
(function () {
  "use strict";
  if (window.__opencodeBetterUI) return;
  window.__opencodeBetterUI = true;

  /* ---------------------------------------------------------------- 文案 */
  var ZH = (navigator.language || "en").toLowerCase().indexOf("zh") === 0;
  var TXT = ZH ? {
    other: "其他", sessions: " 个会话", none: "暂无会话",
    collapse: "折叠该项目会话", expand: "展开该项目会话",
    add: "在「{p}」中新建会话", remove: "从列表移除「{p}」（可恢复）",
    restore: "恢复已移除的 {p} 个项目", lb: "菜单栏"
  } : {
    other: "Other", sessions: " sessions", none: "No sessions",
    collapse: "Collapse project sessions", expand: "Expand project sessions",
    add: "New session in \"{p}\"", remove: "Remove \"{p}\" from the list (restorable)",
    restore: "Restore {p} removed project(s)", lb: "Menu bar"
  };
  var LABELS = ZH
    ? { file: "文件", edit: "编辑", view: "视图", go: "前往", window: "窗口", help: "帮助" }
    : { file: "File", edit: "Edit", view: "View", go: "Go", window: "Window", help: "Help" };
  var SECTIONS = ["file", "edit", "view", "go", "window", "help"];
  function tpl(s, p) { return String(s).replace(/\{p\}/g, p); }

  /* --------------------------------------------------------------- 配置 */
  var CFG_KEY = "opencode.betterui.v1";
  var cfg = { collapsed: {}, sessions: {}, hidden: {}, drafts: {} };
  try {
    var raw = localStorage.getItem(CFG_KEY);
    if (raw) {
      var o = JSON.parse(raw);
      if (o && o.collapsed && typeof o.collapsed === "object") cfg.collapsed = o.collapsed;
      if (o && o.sessions && typeof o.sessions === "object") cfg.sessions = o.sessions;
      if (o && o.hidden && typeof o.hidden === "object") cfg.hidden = o.hidden;
      if (o && o.drafts && typeof o.drafts === "object") cfg.drafts = o.drafts;
    }
  } catch (e) {}
  var saveTimer = null;
  function saveCfg() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try {
        var keys = Object.keys(cfg.sessions);
        if (keys.length > 800) {
          var keep = {};
          for (var i = keys.length - 800; i < keys.length; i++) keep[keys[i]] = cfg.sessions[keys[i]];
          cfg.sessions = keep;
        }
        var dk = Object.keys(cfg.drafts);
        if (dk.length > 120) {
          var keepD = {};
          for (var j = dk.length - 120; j < dk.length; j++) keepD[dk[j]] = cfg.drafts[dk[j]];
          cfg.drafts = keepD;
        }
        localStorage.setItem(CFG_KEY, JSON.stringify({
          collapsed: cfg.collapsed, sessions: cfg.sessions, hidden: cfg.hidden, drafts: cfg.drafts,
        }));
      } catch (e) {}
    }, 400);
  }

  /* ---------------------------------------------------------------- 样式 */
  var CSS = [
    /* --- 分组抬头 --- */
    "[data-bui-header]{display:flex;align-items:center;gap:2px;min-width:0;height:26px;margin-top:6px;padding:0 4px 0 2px;border-radius:6px;color:var(--v2-text-text-muted);font-size:11px;font-weight:530;letter-spacing:.02px;user-select:none;flex:none;order:0}",
    "[data-bui-header]:first-child{margin-top:0}",
    "[data-bui-header] [data-bui-fold]{display:flex;align-items:center;justify-content:center;width:18px;height:18px;flex:none;padding:0;border:0;border-radius:4px;background:transparent;color:var(--v2-icon-icon-muted);cursor:pointer}",
    "[data-bui-header] [data-bui-fold]:hover{background-color:var(--v2-overlay-simple-overlay-hover);color:var(--v2-icon-icon-base)}",
    "[data-bui-header] [data-bui-fold] svg{width:10px;height:10px;transition:transform .12s ease}",
    "[data-bui-header][data-bui-collapsed] [data-bui-fold] svg{transform:rotate(-90deg)}",
    "[data-bui-header] [data-bui-name]{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default;padding:0 2px}",
    "[data-bui-header] [data-bui-count]{flex:none;color:var(--v2-text-text-faint);font-weight:440;font-variant-numeric:tabular-nums;padding:0 2px}",
    "[data-bui-header] [data-bui-plus]{display:flex;align-items:center;justify-content:center;width:18px;height:18px;flex:none;padding:0;border:0;border-radius:4px;background:transparent;color:var(--v2-icon-icon-muted);cursor:pointer;opacity:0;transition:opacity .1s ease}",
    "[data-bui-header]:hover [data-bui-plus]{opacity:1}",
    "[data-bui-header] [data-bui-plus]:hover{background-color:var(--v2-overlay-simple-overlay-hover);color:var(--v2-icon-icon-base)}",
    "[data-bui-header] [data-bui-plus] svg{width:12px;height:12px}",
    "[data-bui-header] [data-bui-del]{display:flex;align-items:center;justify-content:center;width:18px;height:18px;flex:none;padding:0;border:0;border-radius:4px;background:transparent;color:var(--v2-icon-icon-muted);cursor:pointer;opacity:0;transition:opacity .1s ease}",
    "[data-bui-header]:hover [data-bui-del]{opacity:1}",
    "[data-bui-header] [data-bui-del]:hover{background-color:var(--v2-overlay-simple-overlay-hover);color:var(--v2-icon-icon-base)}",
    "[data-bui-header] [data-bui-del] svg{width:11px;height:11px}",
    /* --- 已隐藏项目的恢复入口 --- */
    "[data-bui-restore]{display:flex;align-items:center;gap:4px;min-width:0;height:24px;margin-top:6px;padding:0 6px;border-radius:6px;color:var(--v2-text-text-faint);font-size:11px;font-weight:440;cursor:pointer;order:999999}",
    "[data-bui-restore]:hover{background-color:var(--v2-overlay-simple-overlay-hover);color:var(--v2-text-text-base)}",
    "[data-bui-restore] svg{width:11px;height:11px;flex:none}",
    /* --- 菜单栏 --- */
    "[data-bui-menubar]{display:flex;align-items:center;gap:1px;flex:none;margin-inline-start:2px}",
    "[data-bui-menubar] [data-bui-menu]{appearance:none;display:flex;align-items:center;height:24px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--v2-text-text-muted);font:inherit;font-size:13px;font-weight:440;line-height:1;letter-spacing:-.04px;white-space:nowrap;cursor:default}",
    "[data-bui-menubar] [data-bui-menu]:hover{background-color:var(--v2-overlay-simple-overlay-hover);color:var(--v2-text-text-base)}",
    "[data-bui-menubar] [data-bui-menu][data-bui-open]{background-color:var(--v2-background-bg-layer-02);color:var(--v2-text-text-base)}",
    /* --- 原汉堡：变成不可见代理 --- */
    '[data-component="desktop-icon-button"][data-bui-proxy]{position:fixed!important;left:0;top:0;width:1px!important;height:1px!important;opacity:0!important;overflow:hidden!important;pointer-events:none!important;z-index:-1!important}',
    /* --- 探测 / 菜单显示辅助 --- */
    'html[data-bui-probe] [data-component="menu-v2-content"]{opacity:0!important;pointer-events:none!important}',
    '[data-component="menu-v2-content"][data-bui-parent]{opacity:0!important;pointer-events:none!important}',
    /* 菜单定位完成前整体不可见，避免先出现在错误位置再跳过来 */
    'html[data-bui-placing] [data-component="menu-v2-content"].desktop-app-menu:not(.desktop-app-menu-sub){opacity:0!important;pointer-events:none!important}',
    'html[data-bui-placing] [data-component="menu-v2-content"].desktop-app-menu-sub{visibility:hidden!important}',
    /* 子菜单出现在按钮正下方，不需要入场动画 */
    '[data-component="menu-v2-content"].desktop-app-menu-sub{animation:none!important;transition:none!important}',
  ].join("\n");
  function injectCss() {
    if (document.getElementById("bui-style")) return;
    var s = document.createElement("style");
    s.id = "bui-style";
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---------------------------------------------------------------- 工具 */
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(path, w) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 16 16");
    s.setAttribute("width", w || 12);
    s.setAttribute("height", w || 12);
    s.setAttribute("fill", "none");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = path;
    return s;
  }
  var ICON_CHEV = '<path d="M4 6.25L8 10.25L12 6.25" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>';
  var ICON_PLUS = '<path d="M8 3.25V12.75M3.25 8H12.75" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>';
  var ICON_X = '<path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>';
  var ICON_EYE = '<path d="M8 3.5C4.5 3.5 2 8 2 8s2.5 4.5 6 4.5S14 8 14 8s-2.5-4.5-6-4.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.8" stroke="currentColor" stroke-width="1.2"/>';
  function waitFor(fn, ms, cb) {
    var end = Date.now() + (ms || 1000);
    (function poll() {
      var v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return cb(v);
      if (Date.now() > end) return cb(null);
      setTimeout(poll, 50);
    })();
  }
  function fire(node, type) {
    if (!node) return;
    try {
      var C = type.indexOf("pointer") === 0 ? PointerEvent : MouseEvent;
      var init = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
      if (C === PointerEvent) { init.pointerType = "mouse"; init.isPrimary = true; init.buttons = type === "pointerdown" ? 1 : 0; }
      node.dispatchEvent(new C(type, init));
    } catch (e) {}
  }
  function pressOpen(node) {
    if (!node) return;
    fire(node, "pointerdown");
    fire(node, "mousedown");
    fire(node, "pointerup");
    fire(node, "mouseup");
  }
  function press(node) {
    pressOpen(node);
    try { node.click(); } catch (e) {}
  }
  function key(node, k, code) {
    if (!node) return;
    try {
      node.dispatchEvent(new KeyboardEvent("keydown", {
        key: k, code: code || k, keyCode: k === "ArrowRight" ? 39 : k === "Escape" ? 27 : 0,
        which: k === "ArrowRight" ? 39 : k === "Escape" ? 27 : 0,
        bubbles: true, cancelable: true, composed: true
      }));
    } catch (e) {}
  }

  /* ---------------------------------------------------------- 本地服务 API */
  var apiBase = "", apiAuth = {}, apiLoaded = false;
  function isLocal(h) { return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]"; }
  function originOf(u) { try { var x = new URL(u, location.href); return x.protocol === "http:" || x.protocol === "https:" ? x.origin : ""; } catch (e) { return ""; } }
  function setBase(o) {
    if (!o || o === apiBase) return;
    apiBase = o;
    apiLoaded = false;
  }
  function scanPerf() {
    try {
      var es = performance.getEntriesByType("resource"), newest = "";
      for (var i = es.length - 1; i >= 0; i--) {
        var u; try { u = new URL(es[i].name); } catch (e) { continue; }
        if ((u.protocol !== "http:" && u.protocol !== "https:") || u.pathname.indexOf("/api/") !== 0) continue;
        if (!newest) newest = u.origin;
        if (isLocal(u.hostname)) { setBase(u.origin); return; }
      }
      if (newest) setBase(newest);
    } catch (e) {}
  }
  function hookFetch() {
    try {
      var orig = window.fetch;
      if (!orig || orig.__buiHooked) return;
      var wrapped = function (input, init) {
        try {
          var url = typeof input === "string" ? input : input instanceof URL ? input.href : (input && input.url) || "";
          var u = url ? new URL(url, location.href) : null;
          if (u && (u.protocol === "http:" || u.protocol === "https:") && u.pathname.indexOf("/api/") === 0) {
            if (isLocal(u.hostname) || !apiBase) setBase(u.origin);
            var h = null, hs = init && init.headers;
            if (input instanceof Request) { try { h = input.headers.get("authorization"); } catch (e) {} }
            else if (hs && typeof Headers === "function" && hs instanceof Headers) h = hs.get("authorization");
            else if (Array.isArray(hs)) { for (var i = 0; i < hs.length; i++) if (String(hs[i][0]).toLowerCase() === "authorization") h = hs[i][1]; }
            else if (hs && typeof hs === "object") { for (var k in hs) if (String(k).toLowerCase() === "authorization") h = hs[k]; }
            if (h) apiAuth[u.origin] = h;
          }
        } catch (e) {}
        return orig.apply(this, arguments);
      };
      wrapped.__buiHooked = true;
      window.fetch = wrapped;
    } catch (e) {}
  }
  function apiGet(path) {
    if (!apiBase) return Promise.reject(new Error("server unknown"));
    var h = apiAuth[apiBase];
    return fetch(apiBase + path, { headers: h ? { authorization: h } : undefined, cache: "no-store" }).then(function (r) {
      return r.ok ? r.json() : null;
    });
  }
  function unwrap(j) {
    if (!j) return null;
    if (Array.isArray(j)) return j;
    if (j.data !== undefined) return j.data;
    return j;
  }

  /* ------------------------------------------------------------ 项目数据 */
  var projects = [];        // [{id,name,canonical}]
  var projById = {};
  var projAt = 0, projLoading = false;
  function loadProjects(force) {
    if (!apiBase) return;
    if (projLoading) return;
    if (!force && Date.now() - projAt < 15000) return;
    projLoading = true;
    apiGet("/api/project").then(function (j) {
      var arr = unwrap(j);
      if (Array.isArray(arr)) {
        projects = arr.filter(function (p) { return p && p.id; }).map(function (p) {
          return { id: String(p.id), name: p.name ? String(p.name) : shortName(p.canonical), canonical: p.canonical ? String(p.canonical) : "" };
        });
        projById = {};
        for (var i = 0; i < projects.length; i++) projById[projects[i].id] = projects[i];
        projAt = Date.now();
      }
    }, function () {}).then(function () { projLoading = false; decorateSoon(0); });
  }
  function shortName(dir) {
    var s = String(dir || "").replace(/[\\/]+$/, "");
    var i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    return i >= 0 ? s.slice(i + 1) : s;
  }
  function knownProject(id) {
    if (!id) return null;
    for (var i = 0; i < projects.length; i++) if (projects[i].id === id) return projects[i];
    return projById[id] || null;
  }

  /* ----------------------------------------------------------- 会话数据 */
  var sessLoading = {};
  function loadSession(id, cb) {
    if (!id) { cb(false); return; }
    if (cfg.sessions[id] && cfg.sessions[id].p !== undefined) { cb(true); return; }
    if (sessLoading[id]) { sessLoading[id].push(cb); return; }
    sessLoading[id] = [cb];
    var done = function (ok) {
      var list = sessLoading[id] || [];
      delete sessLoading[id];
      for (var i = 0; i < list.length; i++) try { list[i](ok); } catch (e) {}
    };
    if (!apiBase) { done(false); return; }
    apiGet("/api/session/" + encodeURIComponent(id)).then(function (j) {
      var s = unwrap(j);
      if (s && typeof s === "object") {
        cfg.sessions[id] = { p: s.projectID ? String(s.projectID) : "", d: (s.location && s.location.directory) || "" };
        saveCfg();
        done(true);
      } else done(false);
    }, function () { done(false); });
  }
  function sessProject(id) {
    var s = id ? cfg.sessions[id] : null;
    if (!s) return null;
    if (s.p && knownProject(s.p)) return knownProject(s.p);
    if (s.p) return { id: s.p, name: "", canonical: s.d || "" };
    return null;
  }

  /* ------------------------------------------------------------ 会话分组 */
  var headers = {};         // key -> { el, name, count, key }
  var decorateTimer = null, decorating = false;
  function decorateSoon(ms) {
    if (decorateTimer) return;
    decorateTimer = setTimeout(function () { decorateTimer = null; try { decorateSidebar(); } catch (e) {} }, ms == null ? 120 : ms);
  }
  /* 标签直接挂在 data-titlebar-tab-list 容器下，抬头也要插进同一个容器才有排序效果 */
  function sidebarRoot() {
    var sb = document.querySelector('[data-slot="vertical-tabs-sidebar"]');
    if (!sb) return null;
    var scroll = sb.querySelector('[data-slot="vertical-tabs-scroll"]') || sb.querySelector('[data-slot^="vertical-tabs"]');
    if (!scroll) return null;
    var list = null;
    for (var i = 0; i < scroll.children.length; i++) {
      var c = scroll.children[i];
      if (c.hasAttribute && c.hasAttribute("data-titlebar-tab-list") && c.querySelector("[data-titlebar-tab-slot]")) {
        list = c;
        break;
      }
    }
    return { scroll: scroll, list: list || scroll };
  }
  function tabLink(node) {
    if (!node || !node.querySelector) return null;
    return node.querySelector('a[data-titlebar-tab-link]') || node.querySelector('a[href*="/session/"]');
  }
  function sidOf(href) {
    var m = /\/session\/([^\/?#]+)/.exec(href || "");
    if (!m) return "";
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }
  function draftIdOf(href) {
    var m = /draftId=([^&#]+)/.exec(href || "");
    if (!m) return "";
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }
  function hrefOf(node) {
    var link = tabLink(node);
    return link ? link.getAttribute("href") || "" : "";
  }
  function tabName(node) {
    var n = node && node.querySelector('[data-slot="tab-project"]');
    return n ? (n.textContent || "").trim() : "";
  }
  function isTabSlot(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.hasAttribute("data-bui-header") || node.hasAttribute("data-bui-restore")) return false;
    return node.hasAttribute("data-titlebar-tab-slot") || node.hasAttribute("data-titlebar-tab");
  }
  function currentDraftId() {
    try {
      var id = window.electron && window.electron.windowID;
      if (!id) return "";
      var u = localStorage.getItem("opencode.desktop.window." + id + ".last-active-url") || "";
      return draftIdOf(u);
    } catch (e) {
      return "";
    }
  }
  function groupKeyFor(node) {
    var href = hrefOf(node);
    var sid = sidOf(href);
    var nm = tabName(node);
    var inf = sid ? cfg.sessions[sid] : null;
    if (inf && inf.p && knownProject(inf.p)) return { key: "p:" + inf.p, proj: knownProject(inf.p), sid: sid };
    if (inf && inf.p) return { key: "p:" + inf.p, proj: { id: inf.p, name: nm, canonical: inf.d || "" }, sid: sid };
    var did = draftIdOf(href);
    if (did) {
      var d = cfg.drafts[did];
      if (d && d.p && knownProject(d.p)) return { key: "p:" + d.p, proj: knownProject(d.p), sid: "", draft: did };
      if (d && d.p) return { key: "p:" + d.p, proj: { id: d.p, name: d.n || nm, canonical: d.c || "" }, sid: "", draft: did };
    }
    if (nm) return { key: "n:" + nm, proj: { id: "", name: nm, canonical: "" }, sid: sid };
    return { key: "__other", proj: null, sid: sid, draft: did };
  }
  function headerFor(key, proj, tabsCount, hasTabs) {
    var h = headers[key];
    if (!h || !h.el.isConnected) {
      h = headers[key] = buildHeader(key);
    }
    var collapsed = cfg.collapsed[key];
    if (collapsed === undefined) collapsed = !hasTabs;
    h.collapsed = !!collapsed;
    h.count = tabsCount;
    h.proj = proj;
    var name = proj ? (proj.name || shortName(proj.canonical) || proj.id) : TXT.other;
    h.nameEl.textContent = name;
    h.countEl.textContent = tabsCount ? String(tabsCount) : TXT.none;
    h.foldBtn.title = h.collapsed ? TXT.expand : TXT.collapse;
    h.plusBtn.title = tpl(TXT.add, name);
    h.plusBtn.setAttribute("aria-label", h.plusBtn.title);
    h.delBtn.title = tpl(TXT.remove, name);
    h.delBtn.setAttribute("aria-label", h.delBtn.title);
    if (h.collapsed) h.el.setAttribute("data-bui-collapsed", "");
    else h.el.removeAttribute("data-bui-collapsed");
    return h;
  }
  function buildHeader(key) {
    var el0 = el("div", { "data-bui-header": "" });
    var fold = el("button", { type: "button", "data-bui-fold": "", tabindex: "-1" });
    fold.appendChild(svg(ICON_CHEV, 10));
    var name = el("span", { "data-bui-name": "" });
    var count = el("span", { "data-bui-count": "" });
    var plus = el("button", { type: "button", "data-bui-plus": "" });
    plus.appendChild(svg(ICON_PLUS, 12));
    var del = el("button", { type: "button", "data-bui-del": "", tabindex: "-1" });
    del.appendChild(svg(ICON_X, 11));
    el0.appendChild(fold); el0.appendChild(name); el0.appendChild(count); el0.appendChild(plus); el0.appendChild(del);
    var h = { el: el0, nameEl: name, countEl: count, foldBtn: fold, plusBtn: plus, delBtn: del, key: key, proj: null, collapsed: false };
    fold.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); toggleGroup(h); });
    name.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); toggleGroup(h); });
    plus.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      newSessionFor(h.proj);
    });
    del.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      cfg.hidden[h.key] = 1;
      saveCfg();
      decorateSoon(0);
    });
    return h;
  }
  function toggleGroup(h) {
    h.collapsed = !h.collapsed;
    cfg.collapsed[h.key] = h.collapsed;
    saveCfg();
    decorateSoon(0);
  }
  function decorateSidebar() {
    if (decorating) return;
    decorating = true;
    try {
      var roots = sidebarRoot();
      if (!roots) { decorating = false; return; }
      var scroll = roots.scroll, list = roots.list;
      var children = [], i, node;
      for (i = 0; i < list.children.length; i++) {
        node = list.children[i];
        if (node.hasAttribute("data-bui-header")) continue;
        if (node.hasAttribute("data-bui-restore")) continue;
        if (!isTabSlot(node)) continue;
        children.push(node);
      }
      var pending = 0, pendingDraft = 0;
      var groups = [], groupByKey = {};
      function group(key, proj) {
        if (!groupByKey[key]) {
          groupByKey[key] = { key: key, proj: proj, tabs: [], index: groups.length };
          groups.push(groupByKey[key]);
        }
        return groupByKey[key];
      }
      for (i = 0; i < children.length; i++) {
        var info = groupKeyFor(children[i]);
        var g = group(info.key, info.proj);
        g.tabs.push(children[i]);
        if (info.sid && !cfg.sessions[info.sid]) { pending++; loadSession(info.sid, onSession); }
        if (info.draft && !cfg.drafts[info.draft]) pendingDraft++;
      }
      if (pendingDraft) captureActiveDraft();
      /* 主页项目：没有会话的项目也建立分组（默认折叠） */
      if (apiBase) {
        if (!projAt) loadProjects(false);
        for (i = 0; i < projects.length; i++) {
          var p = projects[i];
          if (!p.id) continue;
          if (groupByKey["p:" + p.id]) { groupByKey["p:" + p.id].proj = p; continue; }
          /* 会话已按项目名回退分组时，用项目 id 合并 */
          var byName = p.name && groupByKey["n:" + p.name];
          if (byName) {
            delete groupByKey["n:" + p.name];
            byName.key = "p:" + p.id;
            byName.proj = p;
            groupByKey["p:" + p.id] = byName;
            continue;
          }
          group("p:" + p.id, p);
        }
      }
      /* 应用排序、折叠与「已移除」状态 */
      var used = {}, removed = 0;
      for (i = 0; i < groups.length; i++) {
        var grp = groups[i];
        var hasTabs = grp.tabs.length > 0;
        var order = i * 10000;
        var h = headerFor(grp.key, grp.proj, grp.tabs.length, hasTabs);
        used[grp.key] = 1;
        if (h.el.parentElement !== list) list.appendChild(h.el);
        h.el.style.order = String(order);
        var gone = !!cfg.hidden[grp.key];
        if (gone) removed++;
        h.el.style.display = gone ? "none" : "";
        var hide = h.collapsed || gone;
        for (var j = 0; j < grp.tabs.length; j++) {
          var tab = grp.tabs[j];
          tab.style.order = String(order + 100 + j);
          if (hide) tab.style.display = "none";
          else if (tab.style.display === "none") tab.style.display = "";
        }
      }
      /* 清理不再存在的抬头 */
      for (var k in headers) {
        if (!used[k]) {
          if (headers[k].el.parentNode) headers[k].el.parentNode.removeChild(headers[k].el);
          delete headers[k];
        }
      }
      /* 恢复入口：有被移除的项目时显示 */
      var restore = document.querySelector("[data-bui-restore]");
      if (removed) {
        if (!restore) {
          restore = el("div", { "data-bui-restore": "" });
          restore.appendChild(svg(ICON_EYE, 11));
          restore.appendChild(el("span", {}, ""));
          restore.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            cfg.hidden = {};
            saveCfg();
            decorateSoon(0);
          });
        }
        if (restore.parentElement !== list) list.appendChild(restore);
        restore.lastChild.textContent = tpl(TXT.restore, removed);
        restore.title = tpl(TXT.restore, removed);
      } else if (restore && restore.parentNode) {
        restore.parentNode.removeChild(restore);
      }
    } finally { decorating = false; }
    if (pending) decorateSoon(200);
    function onSession() {
      decorateSoon(80);
    }
  }
  /* 记住「草稿 → 项目」的对应关系：草稿标签本身不带项目信息 */
  function captureActiveDraft() {
    if (pendingNew) return; /* 正在走「＋新建会话」流程时由流程本身记录，避免抢跑 */
    var did = currentDraftId();
    if (!did) return;
    var trigger = pickerTrigger();
    if (!trigger || !trigger.isConnected) return;
    var r = trigger.getBoundingClientRect();
    if (!r.width) return;
    var txt = (trigger.textContent || "").trim();
    if (!txt) return;
    for (var i = 0; i < projects.length; i++) {
      var p = projects[i];
      if (!p.name || txt.indexOf(p.name) < 0) continue;
      var cur = cfg.drafts[did];
      if (!cur || cur.p !== p.id) { /* 补记或纠正（用户可能在草稿里换了项目） */
        cfg.drafts[did] = { p: p.id, n: p.name, c: p.canonical };
        saveCfg();
        decorateSoon(0);
      }
      return;
    }
  }

  /* ---------------------------------------------------- 在项目中新建会话 */
  var pendingNew = null;
  function newSessionFor(proj) {
    pendingNew = proj || null;
    var startDraft = currentDraftId(); /* 切换前可能是上一个草稿，必须等新草稿出现再记录 */
    var btn = document.querySelector('[data-action="vertical-tabs-new-session"]');
    if (btn) btn.click();
    else {
      /* 兜底：键盘快捷键新建会话 */
      try { key(document.activeElement || document.body, "n", "KeyN"); } catch (e) {}
    }
    if (!pendingNew) return;
    waitFor(function () {
      var did = currentDraftId();
      return document.querySelector('[data-component="new-session"]') && pickerTrigger() && did && did !== startDraft;
    }, 4000, function (ok) {
      if (!ok) { pendingNew = null; return; }
      rememberDraft(pendingNew);
      var tries = 0;
      (function openPicker() {
        var trigger = pickerTrigger();
        if (!trigger || !trigger.isConnected) {
          if (++tries < 6) return setTimeout(openPicker, 250);
          pendingNew = null;
          return;
        }
        pressOpen(trigger); /* Kobalte 在 pointerdown 时展开 */
        waitFor(function () { return document.querySelector("#prompt-project-menu"); }, 800, function (menu) {
          if (!menu) {
            if (++tries < 4) return setTimeout(openPicker, 300);
            pendingNew = null;
            return;
          }
          chooseProject(menu);
        });
      })();
    });
  }
  function rememberDraft(proj) {
    if (!proj || !proj.id) return;
    var did = currentDraftId();
    if (!did) return;
    cfg.drafts[did] = { p: proj.id, n: proj.name || "", c: proj.canonical || "" };
    saveCfg();
    decorateSoon(0);
  }
  function chooseProject(menu) {
    var proj = pendingNew;
    var items = menu.querySelectorAll('[data-option-key^="project:"]');
    var target = pickProjectItem(items, proj);
    if (target) rememberDraft(proj);
    if (!target) {
      key(menu, "Escape", "Escape");
      pendingNew = null;
      return;
    }
    press(target);
    /* 选择失败（菜单还在）时重试一次 */
    waitFor(function () { return !document.querySelector("#prompt-project-menu") || null; }, 900, function () {
      var still = document.querySelector("#prompt-project-menu");
      if (still && still.isConnected) {
        press(pickProjectItem(still.querySelectorAll('[data-option-key^="project:"]'), proj));
        waitFor(function () { return !document.querySelector("#prompt-project-menu") || null; }, 700, function () {
          pendingNew = null;
        });
      } else {
        pendingNew = null;
      }
    });
  }
  function pickerTrigger() {
    /* 未激活的标签页也留在 DOM 里（隐藏），只取当前可见的那个 */
    var list = document.querySelectorAll('button[data-action="prompt-project"]');
    for (var i = list.length - 1; i >= 0; i--) {
      var el = list[i];
      if (!el.isConnected) continue;
      var r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
    return null;
  }
  function normPath(s) {
    return String(s || "").toLowerCase().replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  }
  function itemDir(node) {
    var key = node.getAttribute("data-option-key") || "";
    var decoded = key;
    try { decoded = decodeURIComponent(key); } catch (e) {}
    var m = /^project:([^:]*):(.*)$/.exec(decoded);
    return normPath(m ? m[2] : decoded);
  }
  function pickProjectItem(items, proj) {
    if (!items || !items.length) return null;
    var want = proj && proj.name ? String(proj.name) : "";
    var wantDir = normPath(proj && proj.canonical);
    var i, node, txt, dir;
    if (wantDir) {
      /* 先精确匹配目录，避免 "…/GitHub" 命中 "…/GitHub/hazop-tool" */
      for (i = 0; i < items.length; i++) {
        if (itemDir(items[i]) === wantDir) return items[i];
      }
      for (i = 0; i < items.length; i++) {
        dir = itemDir(items[i]);
        if (dir && wantDir.indexOf(dir) >= 0) return items[i];
      }
    }
    for (i = 0; i < items.length; i++) {
      node = items[i];
      txt = (node.textContent || "").trim();
      if (want && txt === want) return node;
    }
    for (i = 0; i < items.length; i++) {
      node = items[i];
      txt = (node.textContent || "").trim();
      /* 选项文本带项目头像首字母前缀，例如 "mmy-opencode-qols" */
      if (want && txt && txt.indexOf(want) >= 0) return node;
    }
    return null;
  }

  /* ------------------------------------------------------------ 菜单栏 */
  function menuHost() {
    var tb = document.querySelector('[data-slot="titlebar-v2"]');
    if (!tb) return null;
    return tb.querySelector('[data-component="desktop-icon-button"]');
  }
  function ensureMenubar() {
    var host = menuHost();
    if (!host || !host.parentElement) return null;
    if (!host.hasAttribute("data-bui-proxy")) host.setAttribute("data-bui-proxy", "");
    var bar = document.querySelector("[data-bui-menubar]");
    if (bar && !bar.isConnected) bar = null;
    if (!bar) {
      bar = el("div", { "data-bui-menubar": "" });
      bar.setAttribute("aria-label", TXT.lb);
      for (var i = 0; i < SECTIONS.length; i++) {
        var b = el("button", { type: "button", "data-bui-menu": SECTIONS[i] });
        b.textContent = LABELS[SECTIONS[i]];
        bar.appendChild(b);
      }
      host.parentElement.insertBefore(bar, host);
    } else if (bar.parentElement !== host.parentElement || bar.nextElementSibling !== host) {
      host.parentElement.insertBefore(bar, host);
    }
    bindBar(bar);
    return bar;
  }
  var activeKey = null, tickTimer = null;
  function bindBar(bar) {
    if (bar.getAttribute("data-bui-bound")) return;
    bar.setAttribute("data-bui-bound", "1");
    bar.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-bui-menu]") : null;
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      toggleSection(b.getAttribute("data-bui-menu"), b);
    }, true);
    bar.addEventListener("pointerenter", function () {
      /* 鼠标一移到菜单栏就先在后台读出真实菜单文案，点击时无需等待 */
      if (!activeKey) probeLabels();
    }, true);
    bar.addEventListener("pointerover", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-bui-menu]") : null;
      if (!b || !activeKey) return;
      if (b.getAttribute("data-bui-menu") !== activeKey) switchSection(b.getAttribute("data-bui-menu"), b);
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && activeKey) setActive(null);
    }, true);
  }
  function setActive(key) {
    activeKey = key;
    var bar = document.querySelector("[data-bui-menubar]");
    if (!bar) return;
    var list = bar.querySelectorAll("[data-bui-menu]");
    for (var i = 0; i < list.length; i++) {
      if (list[i].getAttribute("data-bui-menu") === key) list[i].setAttribute("data-bui-open", "");
      else list[i].removeAttribute("data-bui-open");
    }
    if (key) startTick(); else stopTick();
    if (!key) clearParentMark();
  }
  var lastSubAt = 0;
  function startTick() {
    if (tickTimer) return;
    tickTimer = setInterval(function () {
      if (!activeKey) return;
      var popup = parentPopup();
      if (!popup) { setActive(null); return; }
      if (!popup.hasAttribute("data-bui-parent")) popup.setAttribute("data-bui-parent", "");
      var bar = document.querySelector("[data-bui-menubar]");
      var b = bar && bar.querySelector('[data-bui-menu="' + activeKey + '"]');
      var sub = subPopup();
      if (sub) {
        lastSubAt = Date.now();
        if (b) placeSub(sub, b);
        return;
      }
      /* 用户把鼠标移到别处后 Kobalte 会收起子菜单：保持当前菜单展开 */
      if (Date.now() - lastSubAt > 350) {
        lastSubAt = Date.now();
        var item = findItem(sectionItems(popup), activeKey, SECTIONS.indexOf(activeKey));
        if (item) openSub(item, function () { var s = subPopup(); if (s && b) placeSub(s, b); });
      }
    }, 250);
  }
  function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }
  function parentPopup() {
    return document.querySelector('[data-component="menu-v2-content"].desktop-app-menu:not(.desktop-app-menu-sub)');
  }
  function subPopup() {
    return document.querySelector('[data-component="menu-v2-content"].desktop-app-menu-sub');
  }
  function clearParentMark() {
    var p = document.querySelectorAll("[data-bui-parent]");
    for (var i = 0; i < p.length; i++) p[i].removeAttribute("data-bui-parent");
  }
  function sectionItems(popup) {
    if (!popup) return [];
    var all = popup.querySelectorAll('[data-component="menu-v2-item"]');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var node = all[i];
      if (node.closest(".desktop-app-menu-sub")) continue;
      out.push(node);
    }
    return out;
  }
  function toggleSection(key, btn) {
    if (activeKey === key) { closeMenu(); return; }
    switchSection(key, btn);
  }
  function switchSection(key, btn) {
    if (parentPopup()) {
      closeMenu();
      waitFor(function () { return !parentPopup(); }, 500, function () { probeAndOpen(key, btn); });
    } else {
      probeAndOpen(key, btn);
    }
  }
  function probeAndOpen(key, btn) {
    probeLabels(function () { openSection(key, btn); });
  }
  function openSection(key, btn) {
    var host = menuHost();
    if (!host || !btn) return;
    var r = btn.getBoundingClientRect();
    host.style.left = Math.round(r.left) + "px";
    host.style.top = Math.round(r.top) + "px";
    host.style.width = Math.max(1, Math.round(r.width)) + "px";
    host.style.height = Math.max(1, Math.round(r.height)) + "px";
    /* 定位完成前把菜单整体藏起来，用户不会看到「先出现在别处再跳过来」 */
    document.documentElement.setAttribute("data-bui-placing", "");
    var placed = false;
    var reveal = function () {
      if (placed) return;
      placed = true;
      document.documentElement.removeAttribute("data-bui-placing");
    };
    var popup = parentPopup();
    var open = function () {
      waitFor(parentPopup, 700, function (p) {
        if (!p) { reveal(); setActive(null); return; }
        p.setAttribute("data-bui-parent", "");
        var items = sectionItems(p);
        var idx = SECTIONS.indexOf(key);
        var item = findItem(items, key, idx);
        lastSubAt = Date.now();
        setActive(key);
        if (!item) { reveal(); return; }
        openSub(item, function () {
          var sub = subPopup();
          if (sub) placeSub(sub, btn);
          reveal();
          /* 展开后的前 0.6 秒持续校正，抵消弹出层自身的落位微调 */
          var settleUntil = Date.now() + 600;
          (function settle() {
            var s = subPopup();
            if (s) placeSub(s, btn);
            if (s && Date.now() < settleUntil) requestAnimationFrame(settle);
          })();
        });
      });
      setTimeout(reveal, 1500);
    };
    if (popup) open();
    else openProxy(open, function () { reveal(); setActive(null); });
  }
  function findItem(items, key, idx) {
    if (!items || !items.length) return null;
    var want = LABELS[key];
    var i, txt;
    for (i = 0; i < items.length; i++) {
      txt = (items[i].textContent || "").trim();
      if (want && txt === want) return items[i];
    }
    return items[idx] || null;
  }
  function openProxy(cb, fail) {
    var host = menuHost();
    if (!host) { if (fail) fail(); return; }
    var trig = host.querySelector("button") || host;
    fire(trig, "pointerdown");
    setTimeout(function () {
      if (parentPopup()) { cb(); return; }
      fire(trig, "pointerup"); fire(trig, "mouseup");
      trig.click();
      waitFor(parentPopup, 600, function (p) { if (p) cb(); else if (fail) fail(); });
    }, 30);
  }
  function openSub(item, cb) {
    try { item.focus({ preventScroll: true }); } catch (e) {}
    key(item, "ArrowRight", "ArrowRight");
    fire(item, "pointerenter"); fire(item, "pointermove");
    waitFor(subPopup, 600, function (s) { if (s) cb(); });
  }
  function readXY(elm) {
    var m = /(-?[\d.]+)px\s+(-?[\d.]+)px/.exec((elm.style && elm.style.translate) || "");
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0];
  }
  function placeSub(sub, btn) {
    if (!sub || !btn) return;
    var r = sub.getBoundingClientRect(), b = btn.getBoundingClientRect();
    if (!r.width) return;
    /* getBoundingClientRect 已包含当前 translate，先还原自然位置再计算目标位移，
     * 否则每帧都会把位移重置成基于已位移坐标的增量，导致菜单来回跳动。 */
    var cur = readXY(sub);
    var naturalLeft = r.left - cur[0], naturalTop = r.top - cur[1];
    sub.style.translate = Math.round(b.left - naturalLeft) + "px " + Math.round(b.bottom + 4 - naturalTop) + "px";
    sub.style.zIndex = "2147483000";
  }
  function closeMenu() {
    var popup = parentPopup() || subPopup();
    if (popup) {
      var focused = document.activeElement;
      var target = focused && popup.contains(focused) ? focused : popup;
      key(target, "Escape", "Escape");
      setTimeout(function () {
        if (parentPopup()) {
          var host = menuHost();
          var trig = host && (host.querySelector("button") || host);
          if (trig) trig.click();
        }
      }, 80);
    }
    setActive(null);
  }
  var probed = false, probing = false, probeQueue = [];
  function probeLabels(cb) {
    if (probed) { if (cb) cb(); return; }
    if (cb) probeQueue.push(cb);
    if (probing) return;
    probing = true;
    document.documentElement.setAttribute("data-bui-probe", "");
    var done = function () {
      document.documentElement.removeAttribute("data-bui-probe");
      probing = false;
      probed = true;
      var flush = function () {
        var q = probeQueue;
        probeQueue = [];
        for (var i = 0; i < q.length; i++) try { q[i](); } catch (e) {}
      };
      if (parentPopup()) {
        closeMenu();
        waitFor(function () { return !parentPopup(); }, 500, flush);
      } else flush();
    };
    var read = function (p) {
      var items = sectionItems(p);
      if (items.length === SECTIONS.length) {
        for (var i = 0; i < SECTIONS.length; i++) {
          var txt = (items[i].textContent || "").trim();
          if (txt) LABELS[SECTIONS[i]] = txt;
        }
        var bar = document.querySelector("[data-bui-menubar]");
        if (bar) {
          var bs = bar.querySelectorAll("[data-bui-menu]");
          for (var j = 0; j < bs.length; j++) bs[j].textContent = LABELS[bs[j].getAttribute("data-bui-menu")] || bs[j].textContent;
        }
      }
      done();
    };
    if (parentPopup()) read(parentPopup());
    else openProxy(function () { read(parentPopup()); }, done);
  }

  /* ---------------------------------------------------------------- 启动 */
  function decorate() {
    injectCss();
    ensureMenubar();
    try { decorateSidebar(); } catch (e) {}
  }
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () { scheduled = false; decorate(); }, 150);
  }
  function boot() {
    injectCss();
    hookFetch();
    try {
      var b = window.electron && window.electron.bootstrap;
      if (b && b.defaultServerUrl) setBase(originOf(b.defaultServerUrl));
    } catch (e) {}
    scanPerf();
    loadProjects(true);
    decorate();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(function () { if (document.visibilityState !== "hidden") { scanPerf(); loadProjects(false); schedule(); } }, 3000);
    window.__betterui = {
      version: 1,
      state: function () {
        return {
          server: apiBase, projects: projects.length, sessions: Object.keys(cfg.sessions).length,
          groups: Object.keys(headers), menubar: !!document.querySelector("[data-bui-menubar]"),
          active: activeKey, labels: LABELS,
        };
      },
      redraw: schedule,
    };
    try { console.info("[betterui] v1 ready"); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
