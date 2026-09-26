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
  const React = window.React,
    ReactDOM = window.ReactDOM;
  if (!React || !ReactDOM) {
    console.error("[mock] React/ReactDOM missing — vendor them under vendor/");
    return;
  }
  const h = React.createElement;
  const S = window.__HARNESS__ || {};
  const MEMO = Symbol.for("react.memo");

  // ── Hermetic RPC stub ───────────────────────────────────────────────────────
  // The runtime fetches `getRuntimeConfig` / `getConfig` / `getLogs` from the
  // daemon's RPC endpoint to populate the fallback panel's Configuration / Updates
  // / Logs sections. In the harness there is no daemon, so we stub `fetch` to the
  // RPC endpoint with canned, representative results — the scenario harness stays
  // hermetic (no live daemon needed, no silent dependence on one). Only the RPC
  // endpoint is intercepted; anything else falls through to the real fetch.
  (function stubRpc() {
    const RPC_HOST = "127.0.0.1:60123"; // matches the runtime's default RPC_ENDPOINT
    const results = {
      getRuntimeConfig: {
        loader_possible: true, native_qam: true, prerelease: false,
        interval_secs: 30, owner_settle_secs: 0, force_owner: "", recover_cmd: "",
        paused: false, pending_hub_update: null, hub_update_staged: false,
        config_file: "/mock/shelveshub.config.json",
      },
      getConfig: {
        auto_update: false, auto_update_hub: true, hub_prerelease: false,
        auto_update_plugin: true, plugin_prerelease: false, version: "0.0.1",
        paused: false, pending_hub_update: null, hub_update_staged: false,
      },
      getLogs: [],
    };
    const realFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = function (url, opts) {
      try {
        if (typeof url === "string" && url.indexOf(RPC_HOST) >= 0) {
          let method = "";
          try { method = JSON.parse((opts && opts.body) || "{}").method || ""; } catch (e) {}
          const result = Object.prototype.hasOwnProperty.call(results, method) ? results[method] : true;
          return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, result: result }); } });
        }
      } catch (e) {}
      return realFetch ? realFetch(url, opts) : Promise.reject(new Error("no fetch"));
    };
  })();

  // ── QuickAccessTab enum (Steam's numeric tab keys) ────────────────────────
  const QuickAccessTab = {
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
        const id = t.key != null ? t.key : t.tab;
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
  const bvExport = { $$typeof: MEMO, type: QuickAccessMenuBrowserView, compare: null };
  const embExport = { $$typeof: MEMO, type: QuickAccessMenuEmbedded, compare: null };
  const qamModule = { BrowserView: bvExport, Embedded: embExport };

  // ── jsx-runtime shim over React.createElement ─────────────────────────────
  const jsxRuntime = {
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

  /* ── Native, gamepad-focusable UI components (scenario flag `nativeUi`) ─────
     Shaped so the runtime's ensureUi() discovery finds them: ButtonItem and
     ToggleField are forwardRef-shaped (renderSrc reads `.render`) and carry the
     discovery marker in a comment; PanelSection/Row are plain functions (srcOf
     reads toString). Each renders detectable DOM (`data-native=…`) for assertions. */
  const FORWARD_REF = Symbol.for("react.forward_ref");
  const ButtonItem = {
    $$typeof: FORWARD_REF,
    render: function (props) {
      /* childrenContainerWidth:"min" */
      return h("button", { className: "native-button", "data-native": "button", disabled: !!props.disabled, onClick: props.onClick }, props.children);
    },
  };
  const ToggleField = {
    $$typeof: FORWARD_REF,
    render: function (props) {
      /* ToggleField,fallback */
      return h("div", {
        className: "native-toggle", "data-native": "toggle", "data-checked": props.checked ? "1" : "0",
        onClick: function () { if (!props.disabled && props.onChange) props.onChange(!props.checked); },
      }, props.label);
    },
  };
  // DialogButton — a bare focusable button that spreads its props (like real DFL:
  // `jsx(G,{type:"button",...e,...})`), so runtime-supplied markers pass through.
  const DialogButton = {
    $$typeof: FORWARD_REF,
    render: function (props) {
      /* "DialogButton","_DialogLayout" */
      const p = { className: "native-dialogbutton" };
      for (const k in props) if (k !== "children") p[k] = props[k];
      return h("button", p, props.children);
    },
  };
  function PanelSection(props) {
    /* .PanelSection */
    return h("div", { className: "native-section", "data-native": "section" },
      props.title ? h("div", { className: "native-title", key: "t" }, props.title) : null,
      h("div", { key: "c" }, props.children));
  }
  function PanelSectionRow(props) {
    return h("div", { className: "native-row" }, props.children);
  }
  function CtxComp() { return null; }
  CtxComp.contextType = { _currentValue: {} };
  const commonUi = { Focusable: function Focusable() {}, ToggleField: ToggleField, ButtonItem: ButtonItem, DialogButton: DialogButton, Field: function Field() {}, CtxComp: CtxComp };
  for (let _d = 0; _d < 62; _d++) commonUi["decoy" + _d] = function () { return null; };
  const panelModule = { PanelSection: PanelSection, PanelSectionRow: PanelSectionRow };

  // ── Fake webpack registry ─────────────────────────────────────────────────
  // The module cache (`require.c`) the runtime walks; a few decoy modules so
  // the finders actually have to search.
  const modules = {
    100: React,
    101: ReactDOM,
    102: jsxRuntime,
    200: qamModule,
    201: { QuickAccessTab: QuickAccessTab }, // sole-host enum discovery
    300: { unrelated: function () {} },
    301: { alsoUnrelated: 42 },
  };
  if (S.nativeUi) {
    modules[202] = commonUi;
    modules[203] = panelModule;
  }
  const cache = {};
  Object.keys(modules).forEach(function (id) {
    cache[id] = { exports: modules[id] };
  });
  const require = function (id) {
    return modules[id];
  };
  require.c = cache;
  const chunk = [];
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

  /* ── Render control ────────────────────────────────────────────────────────
     `createRoot` (like Steam) so the container carries the `__reactContainer$…`
     fiber key the runtime's getReactRoot expects; `flushSync` keeps it fully
     synchronous, so assertions read a settled DOM with no concurrent-scheduling
     races and the re-point re-render lands before we report. */
  function ensureRoot() {
    let el = document.getElementById("root");
    if (!el) {
      el = document.createElement("div");
      el.id = "root";
      document.body.appendChild(el);
    }
    return el;
  }
  let root = null;
  let renderTick = 0;
  function render() {
    renderTick++;
    const el = ensureRoot();
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
    const spec = {
      id: "deck-shelves",
      title: "Deck Shelves",
      content: function () {
        return h("div", { className: "ds-editor" }, "DECK SHELVES EDITOR (mirrored)");
      },
    };
    const q = window.__SHELVES_QAM__;
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
      const out = [];
      document.querySelectorAll(".qam-tab").forEach(function (n) {
        out.push(n.getAttribute("data-tabkey"));
      });
      return out;
    }
    function shelvesTabText() {
      let found = "";
      document.querySelectorAll(".qam-tab").forEach(function (n) {
        const k = n.getAttribute("data-tabkey");
        if (k === "900") found = n.textContent || "";
      });
      return found;
    }
    const q = window.__SHELVES_QAM__;
    return {
      hostInstalled: !!window.__SHELVES_HOST__,
      owner: String(window.__DECK_SHELVES_OWNER__ || ""),
      bridge: !!q,
      qamOwner: String(window.__SHELVES_QAM_OWNER__ || ""),
      mode: q && q.mode ? String(q.mode()) : "n/a",
      specs: q && q._specs ? Object.keys(q._specs) : [],
      pending: (window.__SHELVES_QAM_PENDING__ || []).length,
      tabKeys: tabKeys(),
      shelvesTabPresent: tabKeys().indexOf("900") >= 0,
      shelvesTabText: shelvesTabText(),
      log: (window.__SHELVES_LOG__ || []).slice(-16),
      errors: (window.__HARNESS_ERRORS__ || []).slice(-6),
      fallbackUi: (function () {
        const panel = document.querySelector("[data-fb-panel]");
        if (!panel) return null;
        const sections = [].map.call(panel.querySelectorAll('[data-fb^="sec-"]'), function (n) {
          return (n.getAttribute("data-fb") || "").replace(/^sec-/, "");
        });
        const has = function (id) { return !!panel.querySelector('[data-fb="' + id + '"]'); };
        return {
          panel: true,
          sections: sections,
          download: has("download"),
          update: has("update"),
          logs: has("logs"),
          disableHub: has("adv-pause"),
          coexistNote: has("updates-note"),
          version: has("version"),
          // The auto-update hierarchy renders one row per visible toggle (data-fb="upd-*").
          updateToggles: panel.querySelectorAll('[data-fb^="upd-"]').length,
        };
      })(),
      openHub: !!document.querySelector('[data-fb="open-hub"]'),
    };
  };

  console.log("[mock] Steam mock ready", JSON.stringify(S));
})();
