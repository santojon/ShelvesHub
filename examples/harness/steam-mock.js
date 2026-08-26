// examples/harness/steam-mock.js
//
// A faithful-enough mock of Steam's CEF renderer internals so the ShelvesHub
// host runtime (runtime/shelves-host.js) can be exercised WITHOUT a Steam Deck.
// It reproduces the exact seams the runtime discovers:
//
//   * a webpack chunk registry (`window.webpackChunksteamui`) whose push
//     protocol hands back a `require` with a `.c` module cache;
//   * modules exporting React / ReactDOM / jsx-runtime (the real vendored
//     React 18 UMD) so `Steam.getReactStack()` finds them;
//   * a `QuickAccessMenuBrowserView` consumer (React.memo-shaped, WRITABLE
//     `.type`) that renders a node carrying `props.tabs` — what the runtime
//     wraps and appends our tab onto;
//   * a `QuickAccessTab` enum (both via `window.DFL` in coexistence and via a
//     webpack module for the sole host).
//
// Scenarios are driven by `window.__HARNESS__` (set by the page before this
// script loads):
//   { coexist: bool,       // a foreign loader (DFL) is present
//     pluginPanel: bool,    // a coexisting plugin registers a QAM panel
//     lateMount: bool }     // mount the QAM BEFORE injecting the runtime
//
// The page then injects the runtime and calls window.__HARNESS_MOUNT_QAM__()
// and window.__HARNESS_RENDER__() at the right moments; assertions read
// window.__HARNESS_REPORT__().

(function () {
  "use strict";
  var React = window.React,
    ReactDOM = window.ReactDOM;
  if (!React || !ReactDOM) {
    console.error("[mock] React/ReactDOM missing — vendor them under vendor/");
    return;
  }
  var h = React.createElement;
  var S = window.__HARNESS__ || {};
  var MEMO = Symbol.for("react.memo");

  // ── QuickAccessTab enum (Steam's numeric tab keys) ────────────────────────
  var QuickAccessTab = {
    Notifications: 0,
    CurrentGame: 1,
    Friends: 2,
    Achievements: 3,
    Settings: 4,
    Perf: 5,
    Help: 6,
    0: "Notifications",
    1: "CurrentGame",
    2: "Friends",
    3: "Achievements",
    4: "Settings",
    5: "Perf",
    6: "Help",
  };

  // ── The tab-list renderer + the QAM consumer ──────────────────────────────
  // The consumer returns an element carrying `props.tabs`; the runtime finds it
  // and pushes our tab. Named so `toString()` contains the discovery substring.
  function TabList(props) {
    return h(
      "div",
      { className: "qam-tablist" },
      (props.tabs || []).map(function (t) {
        var id = t.key != null ? t.key : t.tab;
        return h(
          "div",
          { className: "qam-tab", "data-tabkey": String(id), key: String(id) },
          [
            h("div", { className: "qam-tab-title", key: "t" }, typeof t.tab === "string" ? t.tab : t.title || String(id)),
            h("div", { className: "qam-tab-panel", key: "p" }, typeof t.panel === "function" ? h(t.panel) : t.panel || null),
          ]
        );
      })
    );
  }
  function steamTabs() {
    return [
      { key: 0, tab: "Notifications", panel: h("div", null, "notif") },
      { key: 4, tab: "Settings", panel: h("div", null, "settings") },
      { key: 5, tab: "Perf", panel: h("div", null, "perf") },
      { key: 6, tab: "Help", panel: h("div", null, "help") },
    ];
  }
  // eslint-disable-next-line no-unused-vars
  function QuickAccessMenuBrowserView(props) {
    return h(TabList, { tabs: steamTabs() });
  }
  // eslint-disable-next-line no-unused-vars
  function QuickAccessMenuEmbedded(props) {
    return h(TabList, { tabs: steamTabs() });
  }
  // React.memo-shaped with a plain (writable) `.type`, exactly what the runtime
  // wraps via afterPatch(bv, "type", …). `compare: null` makes React use a
  // SimpleMemoComponent fiber: `elementType` is this memo object (what the
  // re-point's `elementType === bv` lookup matches) while `type` is the inner
  // function (what the re-point rewrites to the patched wrapper) — matching
  // Steam's QAM consumer. A distinct __tick prop each render defeats the memo
  // bailout so the re-pointed type actually re-runs.
  var bvExport = { $$typeof: MEMO, type: QuickAccessMenuBrowserView, compare: null };
  var embExport = { $$typeof: MEMO, type: QuickAccessMenuEmbedded, compare: null };
  var qamModule = { BrowserView: bvExport, Embedded: embExport };

  // ── jsx-runtime shim over React.createElement ─────────────────────────────
  var jsxRuntime = {
    jsx: function (t, p, k) {
      p = p || {};
      if (k !== undefined) p.key = k;
      return h(t, p);
    },
    jsxs: function (t, p, k) {
      p = p || {};
      if (k !== undefined) p.key = k;
      return h(t, p);
    },
    Fragment: React.Fragment,
  };

  // ── Fake webpack registry ─────────────────────────────────────────────────
  // The module cache (`require.c`) the runtime walks; a few decoy modules so
  // the finders actually have to search.
  var modules = {
    100: React,
    101: ReactDOM,
    102: jsxRuntime,
    200: qamModule,
    201: { QuickAccessTab: QuickAccessTab }, // sole-host enum discovery
    300: { unrelated: function () {} },
    301: { alsoUnrelated: 42 },
  };
  var cache = {};
  Object.keys(modules).forEach(function (id) {
    cache[id] = { exports: modules[id] };
  });
  var require = function (id) {
    return modules[id];
  };
  require.c = cache;
  var chunk = [];
  chunk.push = function (item) {
    // webpack push protocol: [ [chunkIds], moreModules, runtimeFn ]
    if (item && typeof item[2] === "function") {
      try {
        item[2](require);
      } catch (e) {
        console.error("[mock] chunk runtime fn threw", e);
      }
    }
    return Array.prototype.push.apply(this, arguments);
  };
  window.webpackChunksteamui = chunk;

  // ── Coexistence: a foreign loader (DFL) present ───────────────────────────
  if (S.coexist) {
    window.DFL = {
      definePlugin: function (fn) {
        return fn;
      },
      QuickAccessTab: QuickAccessTab,
    };
  }

  // ── Render control ────────────────────────────────────────────────────────
  // `createRoot` (like Steam) so the container carries the `__reactContainer$…`
  // fiber key the runtime's getReactRoot expects; `flushSync` keeps it fully
  // synchronous, so assertions read a settled DOM with no concurrent-scheduling
  // races and the re-point re-render lands before we report.
  function ensureRoot() {
    var el = document.getElementById("root");
    if (!el) {
      el = document.createElement("div");
      el.id = "root";
      document.body.appendChild(el);
    }
    return el;
  }
  var root = null;
  var renderTick = 0;
  function render() {
    renderTick++;
    var el = ensureRoot();
    if (!root) root = ReactDOM.createRoot(el);
    ReactDOM.flushSync(function () {
      root.render(h(bvExport, { visible: true, __tick: renderTick }));
    });
  }
  function mountQam() {
    render();
  }
  window.__HARNESS_MOUNT_QAM__ = mountQam;
  window.__HARNESS_RENDER__ = render;

  // ── A coexisting plugin that registers a QAM panel via the bridge ─────────
  // Mirrors what Deck Shelves does under a loader: register into __SHELVES_QAM__
  // if present, else queue in __SHELVES_QAM_PENDING__ (order-independent).
  window.__HARNESS_REGISTER_PLUGIN_PANEL__ = function () {
    var spec = {
      id: "deck-shelves",
      title: "Deck Shelves",
      content: function () {
        return h("div", { className: "ds-editor" }, "DECK SHELVES EDITOR (mirrored)");
      },
    };
    var q = window.__SHELVES_QAM__;
    if (q && typeof q.registerPanel === "function") {
      q.registerPanel(spec);
    } else {
      window.__SHELVES_QAM_PENDING__ = window.__SHELVES_QAM_PENDING__ || [];
      window.__SHELVES_QAM_PENDING__.push(spec);
    }
  };

  // ── Report surface for assertions ─────────────────────────────────────────
  window.__HARNESS_REPORT__ = function () {
    function tabKeys() {
      var out = [];
      document.querySelectorAll(".qam-tab").forEach(function (n) {
        out.push(n.getAttribute("data-tabkey"));
      });
      return out;
    }
    function shelvesTabText() {
      var found = "";
      document.querySelectorAll(".qam-tab").forEach(function (n) {
        var k = n.getAttribute("data-tabkey");
        if (k === "900") found = n.textContent || "";
      });
      return found;
    }
    var q = window.__SHELVES_QAM__;
    return {
      hostInstalled: !!window.__SHELVES_HOST__,
      owner: String(window.__DECK_SHELVES_OWNER__ || ""),
      bridge: !!q,
      mode: q && q.mode ? String(q.mode()) : "n/a",
      specs: q && q._specs ? Object.keys(q._specs) : [],
      pending: (window.__SHELVES_QAM_PENDING__ || []).length,
      tabKeys: tabKeys(),
      shelvesTabPresent: tabKeys().indexOf("900") >= 0,
      shelvesTabText: shelvesTabText(),
      log: (window.__SHELVES_LOG__ || []).slice(-16),
      errors: (window.__HARNESS_ERRORS__ || []).slice(-6),
      fallbackUi: (function () {
        var panel = document.querySelector("[data-fb-panel]");
        if (!panel) return null;
        var buttons = ["download", "update", "logs", "auto"].map(function (id) {
          var el = panel.querySelector('[data-fb="' + id + '"]');
          return { id: id, present: !!el, hasIcon: !!(el && el.querySelector("svg")) };
        });
        return { panel: true, buttons: buttons, hasToggle: !!panel.querySelector('[data-fb="auto"]') };
      })(),
      openHub: !!document.querySelector('[data-fb="open-hub"]'),
    };
  };

  console.log("[mock] Steam mock ready", JSON.stringify(S));
})();
