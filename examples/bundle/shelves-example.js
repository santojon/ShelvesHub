// examples/bundle/shelves-example.js
//
// A self-contained, framework-free stand-in for the real Deck Shelves bundle.
// Its QAM panel is a *mock of the Deck Shelves settings menu* (the one Deck
// Shelves shows in the Steam Quick Access Menu): an "Enabled" activation toggle
// plus collapsible sections (Behavior / Additional features / Shelves / Smart
// Shelves) with Steam-style toggle rows — so the loader's injection + host API
// + panel rendering can be validated against a realistic UI without a build.
//
// Plain ES (an IIFE) so it can be injected verbatim with `Runtime.evaluate`.

(function () {
  "use strict";

  var VERSION = "example-1.1.0";
  var ROOT_ID = "shelves-root";

  // Deck Shelves' own icons (paths taken 1:1 from its icons.tsx; stroke style).
  function svg(inner) {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + "</svg>";
  }
  var ICONS = {
    stack: svg('<line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line>'),
    gear: svg('<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>'),
    plus: svg('<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line>'),
    sparkle: svg('<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"></path><path d="M19 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"></path>'),
  };

  // Sample (mock) shelves shown in the "Shelves" section.
  var SHELVES = [
    { name: "Recently Played", source: "Recentes do Steam", enabled: true },
    { name: "Favorites", source: "Marcados como favoritos", enabled: true },
    { name: "Install Next", source: "Coleção: Para instalar", enabled: false },
  ];

  function log() {
    var a = ["[shelves-example]"].concat([].slice.call(arguments));
    console.log.apply(console, a);
  }

  function resolveHost() {
    if (typeof window !== "undefined" && window.__SHELVES_HOST__) {
      log("using window.__SHELVES_HOST__ (HostApi v" + window.__SHELVES_HOST__.version + ")");
      return window.__SHELVES_HOST__;
    }
    log("window.__SHELVES_HOST__ not found — inert fallback host");
    return {
      version: "fallback",
      lifecycle: { register: function () {}, onMount: function () {}, onUnmount: function () {} },
      rpc: { call: function () { return Promise.reject(new Error("no host rpc")); } },
      routes: { addRoute: function () {}, removeRoute: function () {} },
      notifications: { send: function () {} },
      platform: { getOSVersion: function () { return navigator.userAgent; }, checkCompatibility: function () { return true; }, navigateToApp: function () {} },
      qam: null,
    };
  }

  // ── Steam-style settings widgets (framework-free) ─────────────────────────
  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  // A toggle row: label on the left, Steam-style switch on the right.
  function toggleRow(label, checked, onChange) {
    var row = el("div", "display:flex;align-items:center;justify-content:space-between;" +
      "padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.06);gap:12px");
    row.appendChild(el("span", "font-size:13px;color:#dfe3e8", label));

    var track = el("div");
    function paint() {
      track.style.cssText = "position:relative;width:38px;height:20px;border-radius:11px;flex:0 0 auto;" +
        "cursor:pointer;transition:background 120ms;background:" + (checked ? "#1a9fff" : "#4b5563");
      knob.style.cssText = "position:absolute;top:2px;left:" + (checked ? "20px" : "2px") +
        ";width:16px;height:16px;border-radius:50%;background:#fff;transition:left 120ms";
    }
    var knob = el("div");
    track.appendChild(knob);
    paint();
    track.addEventListener("click", function () {
      checked = !checked; paint();
      try { onChange && onChange(checked); } catch (e) {}
    });
    row.appendChild(track);
    return row;
  }

  // A collapsible section: header (icon + title + count badge + chevron) + body.
  function section(iconSvg, title, count, open, buildBody) {
    var wrap = el("div", "margin:0 0 4px;border-radius:8px;overflow:hidden;background:rgba(255,255,255,0.03)");
    var header = el("div", "display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;user-select:none");
    var icon = el("span", "display:flex;color:#9fb3c8");
    icon.innerHTML = iconSvg;
    header.appendChild(icon);
    header.appendChild(el("span", "flex:1;font-size:13px;font-weight:600;color:#eef1f4", title));
    if (count != null) {
      header.appendChild(el("span", "min-width:20px;text-align:center;font-size:11px;color:#0b0f14;" +
        "background:#9fb3c8;border-radius:10px;padding:1px 7px;font-weight:700", String(count)));
    }
    var chevron = el("span", "color:#8a95a1;font-size:11px;transition:transform 120ms", "▾");
    header.appendChild(chevron);

    var body = el("div");
    body.style.display = open ? "block" : "none";
    chevron.style.transform = open ? "none" : "rotate(-90deg)";
    buildBody(body);

    header.addEventListener("click", function () {
      open = !open;
      body.style.display = open ? "block" : "none";
      chevron.style.transform = open ? "none" : "rotate(-90deg)";
    });
    wrap.appendChild(header);
    wrap.appendChild(body);
    return wrap;
  }

  function actionButton(label) {
    var b = el("button", "background:#2a3340;color:#dfe3e8;border:1px solid #3a4654;border-radius:6px;" +
      "padding:7px 12px;font-size:12px;cursor:pointer;margin-right:8px", label);
    return b;
  }

  // The Deck Shelves settings menu (mock).
  function renderSettings(container, host) {
    container.innerHTML = "";
    container.style.cssText = "font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#e6e8eb";

    // Master activation toggle (Deck Shelves: ToggleField label={t('enabled')}).
    var master = el("div", "background:rgba(26,159,255,0.10);border:1px solid rgba(26,159,255,0.35);" +
      "border-radius:8px;margin-bottom:10px");
    master.appendChild(toggleRow("Ativar Deck Shelves", true, function (v) { log("enabled =", v); }));
    container.appendChild(master);

    // Behavior
    container.appendChild(section(ICONS.gear, "Comportamento", 0, false, function (body) {
      body.appendChild(toggleRow("Ocultar recentes da Home", false, function (v) { log("hideRecents", v); }));
      body.appendChild(toggleRow("Ocultar abas da Home", false, function (v) { log("hideHomeTabs", v); }));
    }));

    // Additional features
    container.appendChild(section(ICONS.plus, "Recursos adicionais", 1, false, function (body) {
      body.appendChild(toggleRow("Verificar atualizações", true, function (v) { log("updates", v); }));
      body.appendChild(toggleRow("Recursos online", false, function (v) { log("online", v); }));
    }));

    // Shelves (open by default)
    container.appendChild(section(ICONS.stack, "Prateleiras", SHELVES.length, true, function (body) {
      var bar = el("div", "display:flex;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.06)");
      var add = actionButton("+ Adicionar");
      add.addEventListener("click", function () { log("add shelf (mock)"); });
      bar.appendChild(add);
      bar.appendChild(actionButton("Importar"));
      bar.appendChild(actionButton("Exportar"));
      body.appendChild(bar);
      SHELVES.forEach(function (sh) {
        var row = el("div", "display:flex;align-items:center;justify-content:space-between;" +
          "padding:9px 14px;border-bottom:1px solid rgba(255,255,255,0.05);gap:12px");
        var left = el("div");
        left.appendChild(el("div", "font-size:13px;color:#eef1f4", sh.name));
        left.appendChild(el("div", "font-size:11px;color:#8a95a1;margin-top:2px", sh.source));
        row.appendChild(left);
        row.appendChild((function () {
          var t = el("div", "flex:0 0 auto");
          t.appendChild(toggleRow("", sh.enabled, function (v) { log("shelf", sh.name, v); }).lastChild);
          return t;
        })());
        body.appendChild(row);
      });
    }));

    // Smart shelves
    container.appendChild(section(ICONS.sparkle, "Prateleiras inteligentes", 0, false, function (body) {
      body.appendChild(toggleRow("Ativar prateleiras inteligentes", false, function (v) { log("smart", v); }));
    }));

    var foot = el("div", "padding:12px 14px;font-size:11px;color:#6b7682;text-align:center",
      "Deck Shelves — mock de configurações (HostApi v" + host.version + ")");
    container.appendChild(foot);
  }

  function registerQamPanel(host) {
    if (!host.qam || typeof host.qam.registerPanel !== "function") return false;
    try {
      host.qam.registerPanel({
        id: "deck-shelves",
        title: "Deck Shelves",
        icon: ICONS.stack,
        render: function (container) { renderSettings(container, host); },
      });
      log("QAM settings panel registered");
      return true;
    } catch (e) { log("registerPanel failed:", e.message); return false; }
  }

  function renderStatus(host, info, hasPanel) {
    var root = document.getElementById(ROOT_ID);
    if (!root) { root = el("div"); root.id = ROOT_ID; document.body.appendChild(root); }
    root.innerHTML = "";
    root.appendChild(el("div", "font:600 13px system-ui;color:#9aa3ad;padding:6px 0",
      hasPanel ? "Deck Shelves: abra o painel pelo ícone de prateleiras." : "Deck Shelves (sem QAM): " + info));
  }

  function boot() {
    var host = resolveHost();
    try { host.lifecycle.register(); } catch (e) {}
    var hasPanel = registerQamPanel(host);

    Promise.allSettled([host.rpc.call("ping"), host.rpc.call("getVersion"), host.rpc.call("isInjected")])
      .then(function (r) {
        var rep = "ping=" + JSON.stringify(val(r[0])) + " ver=" + JSON.stringify(val(r[1])) + " inj=" + JSON.stringify(val(r[2]));
        log("rpc:", rep);
        renderStatus(host, rep, hasPanel);
      });
    function val(x) { return x.status === "fulfilled" ? x.value : "ERR"; }

    renderStatus(host, "(pending)", hasPanel);
    try { host.lifecycle.onMount(function () { log("mounted"); }); } catch (e) {}
    window.__SHELVES_DEMO__ = { loaded: true, version: VERSION, qam: hasPanel, at: Date.now() };
    log("ready");
    return window.__SHELVES_DEMO__;
  }

  if (typeof document !== "undefined" && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
