/*oc-homelander:v4 — OpenCode Desktop：当会话模型来自中国厂商时，计费按人民币显示。*/
(function () {
  "use strict";
  if (window.__opencodeHomelander) return;
  window.__opencodeHomelander = true;

  /* ------------------------------------------------------------ 配置 */
  var LS = "opencode.homelander.v1";
  var RLS = LS + ".rate";
  var DLS = LS + ".diag";
  var FALLBACK = 6.7;
  var cfg = { enabled: true, live: true, rate: FALLBACK, extra: [], hosts: [] };
  try {
    var saved = JSON.parse(localStorage.getItem(LS) || "null");
    if (saved && typeof saved === "object") for (var k in cfg) if (saved[k] !== undefined) cfg[k] = saved[k];
  } catch (e) {}

  /* 中国厂商（含各端点；可经 localStorage extra 追加） */
  var IDS =
    " deepseek moonshotai moonshotai-cn kimi-code-plan-cn kimi-code-plan-global" +
    " zhipuai zhipuai-coding-plan zai zai-coding-plan" +
    " alibaba alibaba-cn alibaba-coding-plan alibaba-coding-plan-cn alibaba-token-plan alibaba-token-plan-cn" +
    " minimax minimax-cn minimax-coding-plan minimax-cn-coding-plan" +
    " volcengine volcengine-coding-plan stepfun stepfun-ai stepfun-step-plan stepfun-ai-step-plan" +
    " tencent-tokenhub tencent-coding-plan tencent-token-plan siliconflow siliconflow-cn" +
    " sensenova iflowcn modelscope qiniu-ai bailing longcat xiaomi xiaomi-token-plan-cn" +
    " drun scnet-token-plan kuae-cloud-coding-plan qihang-ai ebcloud moark ";
  var HOSTS = (" .cn aliyuncs.com volces.com bigmodel.cn moonshot.cn deepseek.com stepfun.com stepfun.ai" +
    " sensenova.cn tbox.cn longcat.chat tencentmaas.com lkeap.cloud.tencent.com xf-yun.com iflow.cn" +
    " modelscope.cn scnet.cn chat.d.run qnaigc.com qhaigc.net kuaecloud.net ebcloud.com moark.com" +
    " xiaomimimo.com minimax.cn api.z.ai " + (cfg.hosts || []).join(" ") + " ").split(" ");

  /* ------------------------------------------------------------ 状态 */
  var base = "", sid = "", prov = {}, papi = {}, loaded = false;
  var authBy = {};          // origin -> Authorization（远端服务器用）
  var rate = FALLBACK, rateAt = 0, last = 0, lastScan = 0;
  var _fetch = typeof fetch === "function" ? fetch.bind(window) : null;

  function log() {
    try { console.log.apply(console, ["[homelander]"].concat([].slice.call(arguments))); } catch (e) {}
  }
  function diag() {
    try {
      localStorage.setItem(DLS, JSON.stringify({
        at: Date.now(), href: location.href, last: lastRoute(), base: base, session: sid,
        provider: prov[sid] || "", china: !!(sid && isCN(prov[sid])), rate: rate, enabled: cfg.enabled,
      }));
    } catch (e) {}
  }
  function isLocal(h) { return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]"; }
  function setBase(origin) {
    if (!origin || origin === base) return;
    base = origin;
    loaded = false;
    log("server =", base);
    if (sid) refresh(sid, true);
  }
  function headers() {
    return authBy[base] ? { authorization: authBy[base] } : undefined;
  }

  function isCN(id) {
    if (!id) return false;
    id = String(id);
    if (IDS.indexOf(" " + id + " ") >= 0) return true;
    if ((cfg.extra || []).indexOf(id) >= 0) return true;
    var u = papi[id] || "";
    if (!u) return false;
    for (var i = 0; i < HOSTS.length; i++) if (HOSTS[i] && u.indexOf(HOSTS[i]) >= 0) return true;
    return false;
  }

  function lastRoute() {
    var id = "";
    try { id = (window.electron && window.electron.windowID) || ""; } catch (e) {}
    if (!id) return "";
    try { return localStorage.getItem("opencode.desktop.window." + id + ".last-active-url") || ""; } catch (e) { return ""; }
  }
  function urlSid(p) {
    var m = (/\/session\/([^\/?#]+)\/?$/.exec((p || "").split(/[?#]/)[0]) || [])[1] || "";
    try { if (m) m = decodeURIComponent(m); } catch (e) {}
    return m;
  }

  /* ------------------------------------------------- 服务器地址发现 */
  function scanPerf() {
    if (Date.now() - lastScan < 900) return;
    lastScan = Date.now();
    try {
      var es = performance.getEntriesByType("resource"), newest = "";
      for (var i = es.length - 1; i >= 0; i--) {
        var u;
        try { u = new URL(es[i].name); } catch (e) { continue; }
        if ((u.protocol !== "http:" && u.protocol !== "https:") || u.pathname.indexOf("/api/") !== 0) continue;
        if (!newest) newest = u.origin;
        if (isLocal(u.hostname)) { setBase(u.origin); return; }
      }
      if (newest) setBase(newest);
    } catch (e) {}
  }

  /* ---------------------------------------------------------- 数据来源 */
  function listOf(j) {
    if (!j) return [];
    if (Array.isArray(j)) return j;
    var a = [j.data, j.messages, j.items];
    for (var i = 0; i < a.length; i++) {
      if (Array.isArray(a[i])) return a[i];
      if (a[i]) {
        if (Array.isArray(a[i].data)) return a[i].data;
        if (Array.isArray(a[i].messages)) return a[i].messages;
      }
    }
    return [];
  }
  function loadProviders() {
    if (loaded || !_fetch || !base) return;
    loaded = true;
    _fetch(base + "/api/provider", { headers: headers(), cache: "no-store" }).then(
      function (r) { return r.ok ? r.json() : null; },
      function () { return null; }
    ).then(function (j) {
      if (!j) { loaded = false; return; }
      var all = Array.isArray(j) ? j
        : Array.isArray(j.all) ? j.all
        : j.data && Array.isArray(j.data.all) ? j.data.all
        : Array.isArray(j.providers) ? j.providers
        : j.data && Array.isArray(j.data) ? j.data : [];
      for (var i = 0; i < all.length; i++) {
        var p = all[i];
        if (!p || !p.id) continue;
        var api = p.api || (p.options && p.options.baseURL) || "";
        if (api) papi[String(p.id)] = String(api).toLowerCase();
      }
      log("providers", all.length);
    });
  }
  function refresh(id, force) {
    if (!_fetch || !base || !id) return;
    if (!force && Date.now() - last < 1200) return;
    last = Date.now();
    var url = base + "/api/session/" + encodeURIComponent(id) + "/message?limit=30&order=desc";
    _fetch(url, { headers: headers(), cache: "no-store" }).then(
      function (r) { if (!r.ok) log("refresh failed", id, r.status); return r.ok ? r.json() : null; },
      function (e) { log("refresh failed", id, String((e && e.message) || e)); return null; }
    ).then(function (j) {
      if (!j) return;
      var arr = listOf(j), p = "";
      for (var i = arr.length - 1; i >= 0; i--) {
        var m = arr[i];
        if (m && (m.type === "assistant" || m.role === "assistant") && m.model && m.model.providerID) {
          p = String(m.model.providerID);
          break;
        }
      }
      if (p) {
        if (prov[id] !== p) { prov[id] = p; log("provider", id, p, isCN(p) ? "CNY" : "USD"); }
        if (!papi[p]) loadProviders();
      }
      diag();
    });
  }
  function watch(input, init) {
    var url = typeof input === "string" ? input : input instanceof URL ? input.href : (input && input.url) || "";
    if (!url || url.indexOf("/api/") < 0) return;
    var u;
    try { u = new URL(url); } catch (e) { return; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    if (u.pathname.indexOf("/api/") !== 0) return;
    if (isLocal(u.hostname) || !base) setBase(u.origin);
    try {
      var h = null, hs = init && init.headers;
      if (input instanceof Request) h = input.headers.get("authorization");
      else if (hs && typeof Headers === "function" && hs instanceof Headers) h = hs.get("authorization");
      else if (Array.isArray(hs)) {
        for (var i = 0; i < hs.length; i++) if (String(hs[i][0]).toLowerCase() === "authorization") h = hs[i][1];
      } else if (hs && typeof hs === "object") {
        for (var k in hs) if (k.toLowerCase() === "authorization") h = hs[k];
      }
      if (h) authBy[u.origin] = h;
    } catch (e) {}
    if (sid) refresh(sid, false);
  }
  if (_fetch) {
    window.fetch = function (input, init) {
      try { watch(input, init); } catch (e) {}
      return _fetch(input, init);
    };
  }

  /* ------------------------------------------------------------ 汇率 */
  function useRate() {
    try {
      var c = JSON.parse(localStorage.getItem(RLS) || "null");
      if (c && typeof c.rate === "number" && c.rate > 0) { rate = c.rate; rateAt = c.at || 0; }
    } catch (e) {}
    if (!cfg.live || Date.now() - rateAt < 864e5 || !_fetch) return;
    var urls = ["https://api.frankfurter.app/latest?from=USD&to=CNY", "https://open.er-api.com/v6/latest/USD"];
    (function next(i) {
      if (i >= urls.length) return;
      _fetch(urls[i], { cache: "no-store" }).then(
        function (r) { return r.ok ? r.json() : null; },
        function () { return null; }
      ).then(function (j) {
        var v = j && j.rates && Number(j.rates.CNY);
        if (v > 0) {
          rate = v; rateAt = Date.now();
          try { localStorage.setItem(RLS, JSON.stringify({ rate: v, at: rateAt })); } catch (e) {}
          log("rate", rate);
        } else next(i + 1);
      });
    })(0);
  }

  /* ------------------------------------------------ 显示：USD -> CNY */
  var NF = Intl.NumberFormat, proto = NF.prototype;
  var dF = Object.getOwnPropertyDescriptor(proto, "format");
  var dP = Object.getOwnPropertyDescriptor(proto, "formatToParts");
  var fCache = {}, saidInactive = false, saidActive = "";
  function usd(inst) {
    try {
      var o = inst.resolvedOptions();
      return o.style === "currency" && o.currency === "USD";
    } catch (e) { return false; }
  }
  function active(inst) {
    return cfg.enabled && !!sid && !!prov[sid] && isCN(prov[sid]) && usd(inst);
  }
  function cny(inst) {
    var loc = "en";
    try { loc = inst.resolvedOptions().locale || loc; } catch (e) {}
    if (!fCache[loc]) fCache[loc] = new NF(loc, { style: "currency", currency: "CNY", currencyDisplay: "narrowSymbol" });
    return fCache[loc];
  }
  function wrap(d, parts) {
    return {
      configurable: true, enumerable: d.enumerable,
      get: function () {
        var orig = d.get.call(this);
        if (!usd(this)) return orig;
        if (!active(this)) {
          if (!saidInactive) { saidInactive = true; log("cost formatter seen, inactive", sid || "-", (sid && prov[sid]) || "-"); route(); }
          return orig;
        }
        var self = this, key = sid + "|" + prov[sid];
        if (saidActive !== key) { saidActive = key; log("convert", prov[sid], "rate", rate); }
        return function (v) {
          try {
            var n = Number(v);
            if (!isFinite(n) || !active(self)) return orig(v);
            var f = cny(self);
            return parts ? f.formatToParts(n * rate) : f.format(n * rate);
          } catch (e) { return orig(v); }
        };
      }
    };
  }
  try {
    if (dF && dF.get) Object.defineProperty(proto, "format", wrap(dF, false));
    if (dP && dP.get) Object.defineProperty(proto, "formatToParts", wrap(dP, true));
  } catch (e) {}

  /* ------------------------------------------------------------ 启动 */
  function route() {
    var m = urlSid(location.pathname);
    if (!m) m = urlSid(lastRoute());
    if (m !== sid) { sid = m; log("session =", sid || "(none)"); }
    if (!base) scanPerf();
    if (sid) refresh(sid, true);
    diag();
  }
  function boot() {
    log("boot v4", location.href);
    try {
      var b = window.electron && window.electron.bootstrap;
      if (b && b.defaultServerUrl) log("defaultServerUrl", b.defaultServerUrl);
    } catch (e) {}
    useRate();
    scanPerf();
    route();
    var ps = history.pushState, rs = history.replaceState;
    history.pushState = function () { var r = ps.apply(this, arguments); setTimeout(route, 0); return r; };
    history.replaceState = function () { var r = rs.apply(this, arguments); setTimeout(route, 0); return r; };
    window.addEventListener("popstate", function () { setTimeout(route, 0); });
    window.addEventListener("visibilitychange", function () { if (document.visibilityState !== "hidden") route(); });
    try {
      var setItem = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function (key, value) {
        var r = setItem(key, value);
        try { if (typeof key === "string" && key.indexOf("last-active-url") >= 0) setTimeout(route, 0); } catch (e) {}
        return r;
      };
    } catch (e) {}
    setInterval(function () {
      if (document.visibilityState !== "hidden") route();
    }, 2000);
    setInterval(function () {
      if (document.visibilityState === "hidden") return;
      if (!base) scanPerf();
      if (sid) refresh(sid, false);
    }, 5000);
    window.__homelander = {
      state: function () {
        return { enabled: cfg.enabled, base: base, session: sid, provider: prov[sid] || "", china: !!(sid && isCN(prov[sid])), rate: rate };
      },
      refresh: function () { refresh(sid, true); },
      scan: scanPerf,
      config: cfg
    };
  }
  boot();
})();
