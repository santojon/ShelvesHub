// runtime/shelves-host.js
//
// The ShelvesHub host runtime. Injected by the loader into the Steam UI
// renderer (over CDP) before the Deck Shelves bundle, where it becomes
// `window.__SHELVES_HOST__` — the concrete HostApi the bundle calls into.
//
// It works against the Steam client's own internals: it captures Steam's
// webpack runtime, borrows Steam's own React instance and native,
// gamepad-focusable UI components, and registers a real tab in the Quick Access
// Menu by patching the QAM component. Independent implementation — no
// third-party loader is required or depended on at runtime.
//
// Plain ES (a single IIFE) so it can be injected verbatim with `Runtime.evaluate`.

(function () {
  "use strict";

  // Derived from the daemon's `window.__SHELVES_CONFIG__` stamp (RPC address from
  // its config, contract version from @deck-shelves/host) so nothing is hardcoded
  // here; the literals are a fallback for a standalone load without the stamp.
  var SHELVES_CFG = (function () { try { return window.__SHELVES_CONFIG__ || {}; } catch (e) { return {}; } })();
  var HOST_API_VERSION = SHELVES_CFG.hostApiVersion || "1.1.0";
  var RPC_ENDPOINT = SHELVES_CFG.rpcEndpoint || "http://127.0.0.1:60123";

  if (window.__SHELVES_HOST__ && window.__SHELVES_HOST__.__shelvesRuntime) {
    return window.__SHELVES_HOST__.version;
  }
  // ── Structured logging ────────────────────────────────────────────────────
  // Leveled (INFO/WARN/ERROR) + scoped, the same shape the plugin uses, so the
  // runtime and the daemon read as ONE consistent stream in the log viewer.
  // Every entry is: styled in the renderer console (%c badges), buffered as
  // {t,level,scope,msg} in `window.__SHELVES_LOG__` (bounded ring, newest last),
  // and — WARN/ERROR always, INFO only when `window.__SHELVES_LOG_VERBOSE__` —
  // forwarded (debounced set) to the daemon's ring via the `pushLogs` RPC so
  // `getLogs` returns host + daemon lines together.
  var LOG_SCOPE_COLOR = {
    HOST: "#22c55e", UI: "#a78bfa", ROUTER: "#ec4899", QAM: "#06b6d4",
    MENU: "#f59e0b", NAV: "#3b82f6", RPC: "#0ea5e9", UPDATE: "#14b8a6",
  };
  var LOG_LEVEL_BG = { INFO: "#0ea5e9", WARN: "#f59e0b", ERROR: "#ef4444" };
  var _logQueue = [];
  var _logFlushTimer = null;
  function _logFlushNow() {
    _logFlushTimer = null;
    if (!_logQueue.length) return;
    var set = _logQueue.splice(0, _logQueue.length);
    try {
      fetch(RPC_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "pushLogs", args: set }),
      }).catch(function () {});
    } catch (e) {}
  }
  function _logForward(entry) {
    var verbose = false;
    try { verbose = !!window.__SHELVES_LOG_VERBOSE__; } catch (e) {}
    if (entry.level === "INFO" && !verbose) return; // INFO is opt-in (like the plugin)
    _logQueue.push(entry);
    if (_logQueue.length > 200) _logQueue.shift();
    if (!_logFlushTimer) { try { _logFlushTimer = setTimeout(_logFlushNow, 1000); } catch (e) {} }
  }
  function _logText(args) {
    return args.map(function (x) {
      try { return typeof x === "string" ? x : JSON.stringify(x); } catch (e) { return String(x); }
    }).join(" ");
  }
  function hlog(scope, level, msg, ctx) {
    scope = scope || "HOST"; level = level || "INFO";
    var text = ctx === undefined ? String(msg) : String(msg) + " " + _logText([ctx]);
    try {
      var sc = LOG_SCOPE_COLOR[scope] || "#8b5cf6";
      var lb = LOG_LEVEL_BG[level] || "#0ea5e9";
      var m = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
      m.call(console, "%cShelvesHub%c" + scope + "%c " + text,
        "background:" + lb + ";color:#04121f;padding:1px 4px;font-weight:800;border-radius:2px 0 0 2px",
        "background:" + sc + ";color:#04121f;padding:1px 4px;font-weight:800;border-radius:0 2px 2px 0",
        "color:#93c5fd;font-weight:600");
    } catch (e) {}
    var entry = { t: Date.now(), level: level, scope: scope, msg: text };
    try {
      var b = (window.__SHELVES_LOG__ = window.__SHELVES_LOG__ || []);
      b.push(entry);
      if (b.length > 300) b.shift();
    } catch (e) {}
    _logForward(entry);
    return entry;
  }
  function logInfo(scope, msg, ctx) { return hlog(scope, "INFO", msg, ctx); }
  function logWarn(scope, msg, ctx) { return hlog(scope, "WARN", msg, ctx); }
  function logError(scope, msg, ctx) { return hlog(scope, "ERROR", msg, ctx); }
  // Back-compat: existing `log(...args)` call sites map to INFO/HOST with the
  // joined-args message (same text as before) — so nothing that logs today
  // changes beyond gaining a level/scope, the styled badge, and the buffer entry.
  function log() { return hlog("HOST", "INFO", _logText([].slice.call(arguments))); }

  // ── Coexistence: never break another host, but always keep OUR tab ────────
  // Two separable things this runtime does:
  //   (A) install `window.__SHELVES_HOST__` — the host API the bundle selects
  //       on via its host-selection check. When a plugin loader (the loader) is already
  //       hosting Deck Shelves, installing this makes ITS bundle mis-select the
  //       ShelvesHub adapter and drop its home patches. So (A) is SKIPPED in
  //       coexistence — that is the hard safety invariant: loading ShelvesHub
  //       must never disturb the loader or its plugin.
  //   (B) add our Quick Access tab — harmless, additive (a new tab in the
  //       array; it never removes the other loader's tab). This ALWAYS runs, so
  //       ShelvesHub's tab is present with or without the loader.
  // `SHELVES_FORCE_OWNER=shelveshub` (→ `window.__SHELVES_FORCE_OWNER__`) forces
  // full ownership (installs (A) anyway), an advanced opt-in that needs the
  // loader adapter to stand down cooperatively.
  function otherLoaderPresent() {
    try {
      var w = window;
      return !!(
        w.DeckyPluginLoader ||
        w.deckyHasLoaded ||
        w.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit ||
        w.deckyFrontendLib ||
        (w.DFL && typeof w.DFL.definePlugin === "function") ||
        typeof w.__ds_build !== "undefined"
      );
    } catch (e) { return false; }
  }
  var FORCE_OWNER = false;
  try { FORCE_OWNER = window.__SHELVES_FORCE_OWNER__ === "shelveshub"; } catch (e) {}
  var NATIVE_QAM_REQUESTED = false;
  try { NATIVE_QAM_REQUESTED = window.__SHELVES_NATIVE_QAM__ === true; } catch (e) {}
  var COEXIST = otherLoaderPresent() && !FORCE_OWNER; // tab yes, host no
  if (COEXIST) {
    log("Another plugin loader detected — coexistence mode: adding OUR tab only, NOT taking over the host (its Deck Shelves is left untouched).");
    // Safety stand-down. When the native tab is NOT requested there is nothing
    // to install (host skipped in coexistence) and nothing to patch (the tab is
    // gated on the native-tab opt-in) — so return NOW, before capturing Steam's
    // webpack or enumerating any modules. Walking Steam's module graph
    // (force-require + touching every export) while another loader owns the UI
    // is invasive and a suspected trigger of the Steam UI window teardown (black
    // screen). Truly inert means never touching Steam internals when we have
    // nothing to add.
    if (!NATIVE_QAM_REQUESTED) {
      log("Native tab not requested — standing down without touching Steam internals.");
      return;
    }
  }

  // ── i18n ──────────────────────────────────────────────────────────────────
  // Lightweight i18n for the host's OWN UI (the fallback panel + error text),
  // mirroring the plugin's molds: an ordered prefix→locale map, a
  // navigator-language pick, per-locale dictionaries, and an en-US fallback.
  // Standalone (no framework, no fetch): the plugin's i18n is NOT available when
  // the bundle fails to load — which is exactly when this UI must show text.
  var I18N = (function () {
    var PREFIXES = [
      ["pt-pt", "pt-PT"], ["pt", "pt-BR"], ["es-es", "es-ES"], ["es", "es-419"],
      ["it", "it-IT"], ["fr-ca", "fr-CA"], ["fr", "fr-FR"], ["de", "de-DE"],
      ["ru", "ru-RU"], ["pl", "pl-PL"], ["nl", "nl-NL"], ["tr", "tr-TR"],
      ["uk", "uk-UA"], ["ja", "ja-JP"], ["ko", "ko-KR"], ["zh-tw", "zh-TW"],
      ["zh-hant", "zh-TW"], ["zh", "zh-CN"], ["en-gb", "en-GB"],
    ];
    // Dictionaries live in dedicated per-locale JSON files under runtime/i18n/;
    // the daemon inlines them as `window.__SHELVES_I18N__` at injection time (this
    // runtime is an injected blob and cannot read the files itself). en-US is the
    // fallback for any missing locale/key.
    var DICTS = (function () {
      try {
        if (window.__SHELVES_I18N__ && typeof window.__SHELVES_I18N__ === "object") {
          return window.__SHELVES_I18N__;
        }
      } catch (e) {}
      return {};
    })();
    function pickLocale(l) {
      l = (l || "en-US").toLowerCase();
      for (var i = 0; i < PREFIXES.length; i++) {
        if (l.indexOf(PREFIXES[i][0]) === 0) return PREFIXES[i][1];
      }
      return "en-US";
    }
    var LOCALE = "en-US";
    try { LOCALE = pickLocale(navigator && navigator.language); } catch (e) {}
    function t(key) {
      var d = DICTS[LOCALE];
      if (d && key in d) return d[key];
      var en = DICTS["en-US"];
      if (en && key in en) return en[key];
      return key;
    }
    return { t: t, locale: LOCALE, pickLocale: pickLocale };
  })();

  // ── Steam webpack: module cache + finders ─────────────────────────────────
  var Steam = (function () {
    var modules = new Map(); // id -> module
    var req = null, captureTried = false;

    function capture() {
      if (req || captureTried) return;
      captureTried = true;
      try {
        var key = Object.keys(window).filter(function (k) {
          return k.indexOf("webpackChunk") === 0 && Array.isArray(window[k]);
        })[0];
        if (!key) { captureTried = false; return; } // webpack not up yet — retry later
        window[key].push([[Symbol("shelveshub")], {}, function (r) { req = r; }]);
      } catch (e) { logWarn("HOST", "webpack capture failed: " + (e && e.message)); }
    }

    // Incremental: chunks keep loading long after boot starts, so every call
    // picks up modules that appeared since the last one (early-injection path
    // depends on this — the QAM tab-list builder loads late in boot).
    function init() {
      capture();
      if (!req) return;
      // Prefer the module CACHE (`req.c`): already-instantiated modules, read
      // WITHOUT a force-require, so we never run an unloaded module's factory
      // (side effects) and never block the renderer main thread walking the
      // whole graph. That block is what starved the plugin's async shelf
      // resolves → React #31 → black screen. Another loader (and Steam itself)
      // populates the cache during boot, so it is usually complete by the time
      // we inject; chunks that appear later are picked up on the next call.
      var cache = req.c;
      if (cache && typeof cache === "object") {
        var cids = Object.keys(cache);
        for (var i = 0; i < cids.length; i++) {
          if (modules.has(cids[i])) continue;
          try { var mod = cache[cids[i]]; var ex = mod && mod.exports; if (ex) modules.set(cids[i], ex); } catch (e) {}
        }
        if (modules.size > 0) return; // cache had modules — done, no force-require
      }
      // Last resort (cache empty — nothing loaded yet): force-require. Heavy;
      // only runs when there is no cache to read from at all.
      if (!req.m) return;
      var ids = Object.keys(req.m);
      for (var j = 0; j < ids.length; j++) {
        if (modules.has(ids[j])) continue;
        try { var m = req(ids[j]); if (m) modules.set(ids[j], m); } catch (e) {}
      }
    }

    function findModule(filter) {
      init();
      var it = modules.values(), n;
      while (!(n = it.next()).done) {
        var m = n.value;
        try {
          if (m && m.default && filter(m.default)) return m.default;
          if (filter(m)) return m;
        } catch (e) {}
      }
    }

    function findModuleDetailsByExport(filter, minExports) {
      init();
      var it = modules.entries(), n;
      while (!(n = it.next()).done) {
        var id = n.value[0], m = n.value[1];
        if (!m) continue;
        var variants = [m.default, m];
        for (var vi = 0; vi < variants.length; vi++) {
          var mod = variants[vi];
          if (typeof mod !== "object" || mod == window) continue;
          if (minExports && Object.keys(mod).length < minExports) continue;
          for (var exportName in mod) {
            var ex;
            try { ex = mod[exportName]; } catch (e) { continue; }
            if (!ex) continue;
            try { if (filter(ex, exportName)) return [mod, ex, exportName, id]; } catch (e) {}
          }
        }
      }
      return [undefined, undefined, undefined, undefined];
    }

    function findModuleExport(filter, minExports) { return findModuleDetailsByExport(filter, minExports)[1]; }
    function findModuleByExport(filter, minExports) { return findModuleDetailsByExport(filter, minExports)[0]; }

    function isSteam() { init(); return modules.size > 0; }
    // React stack. A plugin loader normally publishes Steam's React / ReactDOM /
    // jsx-runtime as the globals the bundle reads. In owner mode (no loader) we
    // instead DISCOVER them from Steam's own webpack and expose them on the host
    // object (`host.React` / `host.ReactDOM` / `host.jsx`); the bundle's shims read
    // them from `__SHELVES_HOST__`. We deliberately never publish loader-shaped
    // globals — the host environment stays neutral. When a global is already
    // present (coexistence) we reuse it, so the heavy module scan is skipped there.
    var _stack = null;
    function getReactStack() {
      if (_stack) return _stack;
      var w = window;
      var React = (w.SP_REACT && w.SP_REACT.createElement) ? w.SP_REACT
        : findModule(function (m) {
            return m && typeof m.createElement === "function"
              && typeof m.useState === "function"
              && typeof m.Fragment !== "undefined" && m.Component;
          });
      if (!React || !React.createElement) {
        return { React: null, ReactDOM: null, jsx: null, client: null };
      }
      // `createPortal` is the react-dom marker. Do NOT also require `render` /
      // `createRoot`: React 19's react-dom dropped legacy `render` and moved
      // `createRoot` to react-dom/client, so a strict filter finds nothing.
      var ReactDOM = (w.SP_REACTDOM && w.SP_REACTDOM.createPortal) ? w.SP_REACTDOM
        : findModule(function (m) {
            return m && typeof m.createPortal === "function";
          });
      var jsx = (w.SP_JSX && w.SP_JSX.jsx) ? w.SP_JSX
        : findModule(function (m) {
            return m && typeof m.jsx === "function" && typeof m.jsxs === "function";
          });
      if (!jsx) {
        // Fallback: build jsx from React — jsx(type, config, key) carries
        // children/key in the config object, which createElement accepts.
        var mk = function (type, config, key) {
          var props = config || {};
          if (key !== undefined && key !== null) { props = Object.assign({}, props); props.key = key; }
          return React.createElement(type, props);
        };
        jsx = { Fragment: React.Fragment, jsx: mk, jsxs: mk, jsxDEV: mk };
      }
      var client = (w.SP_REACTDOM_CLIENT && w.SP_REACTDOM_CLIENT.createRoot) ? w.SP_REACTDOM_CLIENT
        : findModule(function (m) {
            return m && typeof m.createRoot === "function" && typeof m.hydrateRoot === "function";
          });
      if (!client && ReactDOM && typeof ReactDOM.createRoot === "function") client = ReactDOM;
      // React 19 splits the portal API (react-dom) from the root API
      // (react-dom/client); expose a ReactDOM carrying BOTH so the bundle's
      // react-dom (createPortal) and react-dom-client (createRoot) shims are both
      // satisfied from `host.ReactDOM`.
      if (ReactDOM && client && typeof ReactDOM.createRoot !== "function" && typeof client.createRoot === "function") {
        ReactDOM = Object.assign({}, ReactDOM, {
          createRoot: client.createRoot,
          hydrateRoot: client.hydrateRoot,
        });
      }
      _stack = { React: React, ReactDOM: ReactDOM || null, jsx: jsx, client: client || null };
      return _stack;
    }
    function getReact() { return getReactStack().React; }

    return {
      get modules() { init(); return modules; },
      findModule: findModule,
      findModuleDetailsByExport: findModuleDetailsByExport,
      findModuleExport: findModuleExport,
      findModuleByExport: findModuleByExport,
      isSteam: isSteam, getReact: getReact, getReactStack: getReactStack, init: init,
    };
  })();

  var ReactStack = Steam.getReactStack();
  var React = ReactStack.React;
  function h() { return React.createElement.apply(React, arguments); }

  // Steam's platform React globals (SP_REACT / SP_REACTDOM / SP_JSX). This Steam
  // build does not set them in this JS context, but the plugin reads them directly
  // (its React accessor and the menu passive-capture hook, which patches
  // SP_REACT.createElement) — without them the game context menu can't build. Publish
  // the SAME React stack we discovered from Steam's webpack, only when absent. These
  // are Steam's own platform globals, not a loader surface — the host stays neutral.
  try {
    if (React && !window.SP_REACT) window.SP_REACT = React;
    if (ReactStack.ReactDOM && !window.SP_REACTDOM) window.SP_REACTDOM = ReactStack.ReactDOM;
    if (ReactStack.jsx && !window.SP_JSX) window.SP_JSX = ReactStack.jsx;
  } catch (e) {}

  // Build a regex matching a minified `const {a:b,c:d}` prop destructuring, in
  // the given prop order (Steam component discovery technique).
  function propListRegex(props, fromStart) {
    if (fromStart === undefined) fromStart = true;
    var s = fromStart ? "const\\{" : "";
    for (var i = 0; i < props.length; i++) {
      s += '"?' + props[i] + '"?:[a-zA-Z_$]{1,2}';
      if (i < props.length - 1) s += ",";
    }
    return new RegExp(s);
  }
  function srcOf(v) {
    try {
      if (typeof v === "function" && v.toString) return v.toString();
    } catch (e) {}
    return "";
  }
  function renderSrc(v) {
    try { if (v && v.render && v.render.toString) return v.render.toString(); } catch (e) {}
    return "";
  }

  // ── Steam's native, gamepad-focusable UI components ───────────────────────
  // `ensureUi` is idempotent. The sole-host path calls it eagerly (the bundle
  // needs these to render). Under another loader (COEXIST) it is deferred until
  // the host's own hub view first renders — a user action, off the boot path —
  // because this scan (toString over thousands of exports) blocks the renderer
  // main thread, and at boot that starves the active plugin's async shelf
  // resolves → React #31 → black screen. Off the boot path it is harmless.
  var UI = {};
  var uiReady = false;
  var _commonValues = [];
  // Discovery split into independent steps. One scan off-render is safe (~25ms),
  // but several back-to-back block the main thread long enough to starve the
  // running plugin in coexistence and collapse the Steam UI (observed on-device).
  // So sole-host runs all steps at once at inject (no other plugin to starve);
  // coexistence runs ONE STEP PER IDLE TICK (ensureUiChunked), yielding between.
  var uiSteps = [
    function () {
      var CommonUIModule = Steam.findModule(function (m) {
        if (typeof m !== "object") return false;
        for (var prop in m) {
          try { if (m[prop] && m[prop].contextType && m[prop].contextType._currentValue && Object.keys(m).length > 60) return true; } catch (e) {}
        }
        return false;
      });
      _commonValues = CommonUIModule ? Object.values(CommonUIModule) : [];
      UI.ToggleField = _commonValues.find(function (mod) {
        var s = renderSrc(mod);
        return s.indexOf("ToggleField,fallback") >= 0 || s.indexOf('ToggleField",') >= 0;
      });
      var buttonItemRegex = propListRegex(["highlightOnFocus", "childrenContainerWidth"], false);
      UI.ButtonItem = _commonValues.find(function (mod) {
        var s = renderSrc(mod);
        return buttonItemRegex.test(s) || s.indexOf('childrenContainerWidth:"min"') >= 0;
      });
      // DialogButton — a bare focusable button (not Field-wrapped like ButtonItem).
      // This is what the bundle itself renders in the QAM (its shim maps its buttons
      // to DialogButton), so it is a component proven to render in the injected tab.
      UI.DialogButton = _commonValues.find(function (mod) {
        var s = renderSrc(mod);
        return s.indexOf('"DialogButton"') >= 0 && s.indexOf('"_DialogLayout"') >= 0;
      });
      UI.SliderField = _commonValues.find(function (mod) {
        var s = srcOf(mod);
        return s.indexOf("SliderField,fallback") >= 0 || s.indexOf('SliderField",') >= 0;
      });
    },
    function () {
      var focusableRegex = propListRegex(["flow-children", "onActivate", "onCancel", "focusClassName", "focusWithinClassName"]);
      UI.Focusable = Steam.findModuleExport(function (e) {
        return (typeof e === "function" && focusableRegex.test(srcOf(e))) || focusableRegex.test(renderSrc(e));
      });
    },
    function () {
      UI.Field = Steam.findModuleExport(function (e) {
        return (srcOf(e).indexOf("().Field") >= 0 && srcOf(e).indexOf('"shift-children-below"') >= 0) ||
          renderSrc(e).indexOf('"shift-children-below"') >= 0;
      });
    },
    function () {
      var panelDetails = Steam.findModuleDetailsByExport(function (e) { return srcOf(e).indexOf(".PanelSection") >= 0; });
      UI.PanelSection = panelDetails[1];
      UI.PanelSectionRow = panelDetails[0]
        ? Object.values(panelDetails[0]).filter(function (exp) { return srcOf(exp).indexOf(".PanelSection") < 0; })[0]
        : undefined;
    },
    // ── Extended host.ui surface (sole host) ─────────────────────────────────
    // The QAM panel needs only the widgets above, but the full plugin UI (its
    // own screens, dialogs, menus, navigation) needs more. Under a loader the
    // plugin reaches those through the loader; as the sole host we resolve
    // Steam's own from the webpack (same discovery technique). Each is guarded
    // so a miss never blocks the rest.
    function () {
      // Modals. `showModal` wraps Steam's raw opener with the argument shape the
      // plugin calls; `ConfirmModal` is Steam's confirm dialog.
      var showModalRaw = Steam.findModuleExport(function (e) {
        return typeof e === "function" && srcOf(e).indexOf("props.bDisableBackgroundDismiss") >= 0 && !(e.prototype && e.prototype.Cancel);
      });
      if (showModalRaw) {
        UI.showModal = function (modal, parent, props) {
          props = props || {};
          return showModalRaw(modal, parent || window, props.strTitle || "ShelvesHub", props, undefined, { bHideActions: props.bHideActionIcons });
        };
      }
      UI.ConfirmModal = Steam.findModuleExport(function (e) {
        var s = srcOf(e);
        return s.indexOf("bUpdateDisabled") >= 0 && s.indexOf("closeModal") >= 0 && s.indexOf("onGamepadCancel") >= 0;
      });
      UI.showContextMenu = Steam.findModuleExport(function (e) {
        var s = srcOf(e);
        return typeof e === "function" && s.indexOf("GetContextMenuManagerFromWindow(") >= 0 && s.indexOf(".CreateContextMenuInstance(") >= 0;
      });
    },
    function () {
      // Context menu + form inputs.
      var menuDetails = Steam.findModuleDetailsByExport(function (e) {
        return renderSrc(e).indexOf("bPlayAudio:") >= 0 || (e && e.prototype && e.prototype.OnOKButton && e.prototype.OnMouseEnter);
      });
      UI.Menu = Steam.findModuleExport(function (e) {
        return e && e.prototype && e.prototype.HideIfSubmenu && e.prototype.HideMenu;
      }) || (menuDetails && menuDetails[0]
        ? Object.values(menuDetails[0]).find(function (e) { var s = srcOf(e); return s.indexOf("useId") >= 0 && s.indexOf("labelId") >= 0; })
        : undefined);
      UI.MenuItem = menuDetails ? menuDetails[1] : undefined;
      UI.Dropdown = _commonValues.find(function (m) { return m && m.prototype && m.prototype.SetSelectedOption && m.prototype.BuildMenu; });
      var ddRe = propListRegex(["dropDownControlRef", "description"], false);
      var ddInternal = _commonValues.find(function (m) { return m && ddRe.test(srcOf(m)); });
      if (ddInternal) UI.DropdownItem = function (props) { return h(ddInternal, Object.assign({ childrenContainerWidth: "min" }, props || {})); };
      UI.TextField = _commonValues.find(function (m) { return m && m.validateUrl && m.validateEmail; });
    },
    function () {
      // Tabs, Spinner, and Navigation (the plugin's screen routing + Back).
      var tabsModule = Steam.findModuleByExport(function (e) {
        var s = srcOf(e); return s.indexOf(".TabRowTabs") >= 0 && s.indexOf("activeTab:") >= 0;
      });
      if (tabsModule) UI.Tabs = Object.values(tabsModule).find(function (e) { return e && e.type && srcOf(e.type).indexOf("(function()") >= 0; });
      UI.Spinner = Steam.findModuleExport(function (e) {
        var s = srcOf(e); return s.indexOf("Steam Spinner") >= 0 && s.indexOf("src") >= 0;
      });
      var Router = Steam.findModuleExport(function (e) { return e && e.Navigate && e.NavigationManager; });
      if (Router) {
        var navFn = function (name, handler) {
          return function () {
            var win;
            try { win = window.SteamUIStore.GetFocusedWindowInstance(); } catch (e) {}
            if (!win) win = (Router.WindowStore && (Router.WindowStore.GamepadUIMainWindowInstance || (Router.WindowStore.SteamUIWindows && Router.WindowStore.SteamUIWindows[0]))) || null;
            if (!win) { log("nav: no window for " + name); return; }
            try { var t = handler ? handler(win) : null; (t || win)[name].apply(t || win, arguments); }
            catch (e) { log("nav " + name + ":", e && e.message); }
          };
        };
        var navigator = function (w) { return w.Navigator; };
        var menuStore = function (w) { return w.MenuStore; };
        UI.Navigation = {
          Navigate: navFn("Navigate"),
          NavigateBack: navFn("NavigateBack"),
          NavigateToAppProperties: navFn("AppProperties", navigator),
          NavigateToExternalWeb: navFn("ExternalWeb", navigator),
          NavigateToLibraryTab: navFn("LibraryTab", navigator),
          NavigateToSteamWeb: navFn("NavigateToSteamWeb"),
          OpenSideMenu: navFn("OpenSideMenu", menuStore),
          OpenQuickAccessMenu: navFn("OpenQuickAccessMenu", menuStore),
          OpenMainMenu: navFn("OpenMainMenu", menuStore),
          CloseSideMenus: navFn("CloseSideMenus", menuStore),
          NavigateToLayoutPreview: Router.NavigateToLayoutPreview ? Router.NavigateToLayoutPreview.bind(Router) : undefined,
          OpenPowerMenu: Router.OpenPowerMenu ? Router.OpenPowerMenu.bind(Router) : undefined
        };
      }
    },
    function () {
      // Structural dialog components (DialogBody / DialogControlsSection): Steam
      // exposes these as div wrappers distinguishable only by the class name they
      // render, so render each candidate with empty props and map by the leading
      // class name (guarded — a render can throw).
      var byClass = {};
      _commonValues.forEach(function (m) {
        if (!m || typeof m !== "object") return;
        var rs = renderSrc(m);
        if (rs.indexOf('jsx)("div",{...') < 0 && rs.indexOf('jsx)("div",Object.assign({},') < 0 &&
          rs.indexOf('createElement("div",{...') < 0 && rs.indexOf('createElement("div",Object.assign({},') < 0) return;
        try {
          var el = m.render({});
          var cn = el && el.props && el.props.className;
          if (cn) { var key = cn.split(" ")[0]; if (!byClass[key]) byClass[key] = m; }
        } catch (e) {}
      });
      UI.DialogBody = byClass.DialogBody;
      UI.DialogControlsSection = byClass.DialogControlsSection;
      // GamepadButton is a static enum, not a component — provide it directly.
      UI.GamepadButton = {
        INVALID: 0, OK: 1, CANCEL: 2, SECONDARY: 3, OPTIONS: 4, BUMPER_LEFT: 5, BUMPER_RIGHT: 6,
        TRIGGER_LEFT: 7, TRIGGER_RIGHT: 8, DIR_UP: 9, DIR_DOWN: 10, DIR_LEFT: 11, DIR_RIGHT: 12,
        SELECT: 13, START: 14, LSTICK_CLICK: 15, RSTICK_CLICK: 16, LSTICK_TOUCH: 17, RSTICK_TOUCH: 18,
        LPAD_TOUCH: 19, LPAD_CLICK: 20, RPAD_TOUCH: 21, RPAD_CLICK: 22, REAR_LEFT_UPPER: 23,
        REAR_LEFT_LOWER: 24, REAR_RIGHT_UPPER: 25, REAR_RIGHT_LOWER: 26, STEAM_GUIDE: 27, STEAM_QUICK_MENU: 28
      };
    },
  ];
  function runUiStep(i) { try { uiSteps[i](); } catch (e) { log("ui step " + i + ":", e && e.message); } }
  function ensureUi() {
    if (uiReady || !React) return UI;
    uiReady = true;
    for (var i = 0; i < uiSteps.length; i++) runUiStep(i);
    return UI;
  }
  function ensureUiChunked(onDone) {
    if (uiReady || !React) { if (onDone) onDone(); return; }
    uiReady = true;
    var i = 0;
    // A plain timer, NOT requestIdleCallback: Steam's renderer is never idle, so
    // the idle callback never fires. The gap between ticks lets the plugin run so
    // no cumulative starvation builds up; each single scan is short (measured safe).
    (function next() {
      if (i >= uiSteps.length) { if (onDone) onDone(); return; }
      runUiStep(i++);
      setTimeout(next, 80);
    })();
  }
  // Publish "Steam's UI is populated" as a window global so the preload gate can
  // defer the bundle boot until host.ui is ready (the bundle reads host.ui.* at
  // boot). Coexist sets it synchronously (the borrow below); sole-host sets it
  // from the chunked scan's onDone. Idempotent + safe if window is unavailable.
  function signalUiReady() { try { window.__SHELVES_UI_READY__ = true; } catch (e) {} }
  // Sole host: no loader to borrow from, so the webpack must be scanned for Steam's
  // UI — but CHUNKED (one step per timer tick), NEVER the sync all-at-once scan,
  // which stalls the main thread at boot → black screen. Signal readiness when the
  // scan lands so the preload gate releases the bundle only once host.ui exists.
  if (React && !COEXIST) ensureUiChunked(function () { augmentHostUi(signalUiReady); });
  // Coexist: the loader already resolved every Steam UI component — borrow them
  // directly. A webpack discovery scan on the INJECT path (even chunked) stalls the
  // renderer main thread long enough to collapse the Steam UI windows (black
  // screen), and it runs on every inject with the QAM closed. Borrowing avoids the
  // scan entirely; the scan remains only as the sole-host / no-lib fallback below.
  if (React && COEXIST) {
    try {
      var _lib = window.DFL || window.deckyFrontendLib;
      if (_lib) {
        ["Focusable", "ButtonItem", "DialogButton", "ToggleField", "SliderField", "Field", "PanelSection", "PanelSectionRow"].forEach(function (k) {
          if (_lib[k]) UI[k] = _lib[k];
        });
        if (UI.Focusable) uiReady = true;
        log("QAM UI: borrowed from loader (no scan) — " + Object.keys(UI).length + " components.");
      }
    } catch (e) {}
    // Coexist UI is ready synchronously (borrowed above, or the bundle is dormant
    // under the loader anyway) — release the bundle gate now, no wait.
    signalUiReady();
  }

  // Steam's Focusable — the single component the QAM tab panel needs to join
  // Steam's gamepad-focus navigation (the loader wraps its plugin view in it). It is
  // discovered on demand OFF the render path (scheduled in QamHost): one webpack
  // scan, which black-screens if run during a React render but is safe when the
  // renderer is idle. Reuses UI.Focusable when the sole-host path already found it.
  var focusableComp = null;
  var focusableTried = false;
  function ensureFocusable() {
    if (focusableComp) return focusableComp;
    if (UI.Focusable) { focusableComp = UI.Focusable; return focusableComp; }
    if (focusableTried || !React) return focusableComp;
    focusableTried = true;
    try {
      var re = propListRegex(["flow-children", "onActivate", "onCancel", "focusClassName", "focusWithinClassName"]);
      focusableComp = Steam.findModuleExport(function (e) {
        return (typeof e === "function" && re.test(srcOf(e))) || re.test(renderSrc(e));
      }) || null;
      log("QAM Focusable: " + (focusableComp ? "found" : "not found") + ".");
    } catch (e) { log("QAM Focusable discovery:", e && e.message); }
    return focusableComp;
  }
  // Native-component rendering (verified safe once discovery stopped scanning on
  // the inject path). ON by default; set window.__SHELVES_NATIVE_UI__ = false as a
  // kill switch. It renders only when the components are actually present anyway
  // (the branches also gate on UI.DialogButton/UI.ToggleField).
  function nativeUiOn() { try { return window.__SHELVES_NATIVE_UI__ !== false; } catch (e) { return true; } }

  // A minimal error boundary so a bad panel render shows a fallback instead of
  // crashing the Steam renderer.
  var ErrorBoundary = null;
  if (React && React.Component) {
    ErrorBoundary = class extends React.Component {
      constructor(p) { super(p); this.state = { err: null }; }
      static getDerivedStateFromError(err) { return { err: err }; }
      componentDidCatch(e, info) {
        logWarn("UI", "panel render error: " + (e && e.message));
        try { window.__SHELVES_NATIVE_ERR__ = { message: e && e.message, stack: e && e.stack, componentStack: info && info.componentStack }; } catch (x) {}
      }
      render() {
        return this.state.err
          ? h("div", { style: { padding: "16px", color: "#ff8d8d", fontSize: "13px" } },
              I18N.t("panel_error"))
          : this.props.children;
      }
    };
  }

  // ── React tree patch helpers ──────────────────────────────────────────────
  // GenericPatchHandler: (args, ret) => newRet. This mirrors the tree-patcher
  // semantics the plugin's menu / recents code relies on, so the same plugin
  // works here as under a loader — but the internals stay neutrally named.
  //
  // The plugin patches `element.type` slots directly (the native recents replace
  // does three nested `afterPatch(el, "type", …)`). On this Steam an `element.type`
  // is very often a React `memo` — an OBJECT, not a callable — or a `forwardRef`.
  // A wrapper that simply re-invokes the original as a function then breaks
  // (a memo is not callable → throws at render → the whole route unmounts). So
  // `afterPatch` PRESERVES the original's shape: it wraps a memo's inner render
  // component (`.type`), a forwardRef's `.render`, or a plain function directly,
  // and `handler.call(this, …)` binds `this` so class-render handlers can read
  // `this.props` (the card menu's inject path resolves the shelf id from it).
  function reactTag(v) { try { return v && v.$$typeof ? "" + v.$$typeof : null; } catch (e) { return null; } }
  function wrapRenderFn(origFn, handler, options, patch) {
    var f = function () {
      var ret = origFn.apply(this, arguments);
      try { ret = handler.call(this, arguments, ret); }
      catch (e) { log("patch handler:", e && e.message); }
      if (options.singleShot) patch.unpatch();
      return ret;
    };
    // Carry the original's static props + reported source forward so Steam's
    // `type.toString()` webpack/render matching keeps working.
    try { Object.assign(f, origFn); } catch (e) {}
    try { f.toString = function () { return origFn.toString(); }; } catch (e) {}
    try { f.__shelvesPatched = true; } catch (e) {}
    return f;
  }
  function afterPatch(object, property, handler, options) {
    options = options || {};
    var orig = object[property];
    var patch = {
      object: object, property: property, handler: handler, original: orig,
      patchedFunction: null, hasUnpatched: false,
      unpatch: function () {
        if (patch.hasUnpatched) return;
        try { object[property] = patch.original; } catch (e) {}
        patch.hasUnpatched = true;
      },
    };
    var replacement, tag = reactTag(orig);
    if (tag && tag.indexOf("react.memo") >= 0 && orig.type) {
      // memo → React renders memo.type(props); wrap the inner render component.
      var memo = {}; for (var mk in orig) memo[mk] = orig[mk];
      memo.type = wrapRenderFn(orig.type, handler, options, patch);
      replacement = memo;
    } else if (tag && tag.indexOf("react.forward_ref") >= 0 && typeof orig.render === "function") {
      var fr = {}; for (var fk in orig) fr[fk] = orig[fk];
      fr.render = wrapRenderFn(orig.render, handler, options, patch);
      replacement = fr;
    } else if (typeof orig === "function") {
      replacement = wrapRenderFn(orig, handler, options, patch);
    } else {
      return patch; // nothing renderable/callable to wrap — leave the slot as-is
    }
    patch.patchedFunction = replacement;
    try { replacement.__shelvesPatch = patch; } catch (e) {}
    try { replacement.__shelvesPatched = true; } catch (e) {}
    object[property] = replacement;
    return patch;
  }

  // findInTree / findInReactTree: recursive search walking the given keys.
  function findInTree(parent, filter, walkable) {
    if (!parent || typeof parent !== "object") return null;
    try { if (filter(parent)) return parent; } catch (e) {}
    if (Array.isArray(parent)) {
      for (var i = 0; i < parent.length; i++) { var r = findInTree(parent[i], filter, walkable); if (r) return r; }
      return null;
    }
    var keys = walkable || Object.keys(parent);
    for (var k = 0; k < keys.length; k++) {
      var v; try { v = parent[keys[k]]; } catch (e) { continue; }
      var found = findInTree(v, filter, walkable);
      if (found) return found;
    }
    return null;
  }
  function findInReactTree(node, filter) {
    return findInTree(node, filter, ["props", "children", "child", "sibling"]);
  }

  function getReactRoot(el) {
    if (!el) return null;
    var fiber = null;
    var k = Object.keys(el).find(function (x) { return x.indexOf("__reactContainer$") === 0; });
    if (k) fiber = el[k];
    else if (el._reactRootContainer && el._reactRootContainer._internalRoot) fiber = el._reactRootContainer._internalRoot.current;
    if (!fiber) return null;
    // The container key holds a FIXED HostRoot fiber; after a render the live
    // tree may be on its alternate (React double-buffers the two HostRoot
    // fibers). Resolve to the FiberRoot's `current` so callers always walk the
    // mounted tree — otherwise a re-point can land on the empty back-buffer.
    try { if (fiber.stateNode && fiber.stateNode.current) return fiber.stateNode.current; } catch (e) {}
    return fiber;
  }

  // ── RouterHook: register full-screen routes and patch existing ones ────────
  // The plugin's own screens (About/Settings) are React-Router routes, and its
  // home shelves are injected by PATCHING the /library/home route's render. Under
  // a loader the loader supplies this hook; as the sole host we patch Steam's own
  // gamepad router: find its node by the `Settings.Root()` its render mentions,
  // then wrap that render to splice our routes into the route list and apply our
  // per-path patches. Best-effort throughout — a failure never tears the UI down
  // (afterPatch swallows handler errors and returns the original render).
  function makeRouterHook() {
    var routes = new Map(); // path -> { component, props }
    var routePatches = new Map(); // path -> Set<patch>
    var globalComponents = new Map(); // id -> component (always-rendered, e.g. the home bridge)
    var RouteComp = null;
    var patched = false;
    var OUR_ARRAY = "__shelvesRoutes"; // marks the sub-array we append
    var IS_PATCHED = "__shelvesRoutePatched"; // marks an already-patched route

    function findRoute() {
      if (RouteComp) return RouteComp;
      try {
        var mod = Steam.findModuleByExport(function (e) { return e === "router-backstack"; }, 20);
        if (mod) {
          RouteComp = Object.values(mod).find(function (e) {
            return typeof e === "function" && /routePath:.\.match\?\.path./.test(srcOf(e));
          }) || null;
        }
      } catch (e) { log("routerHook: Route discovery:", e && e.message); }
      return RouteComp;
    }

    // Apply registered patches to the existing routes in one route-list array.
    function applyPatches(routeList) {
      for (var i = 0; i < routeList.length; i++) {
        var route = routeList[i];
        if (!route || !route.props || !route.props.path) continue;
        var set = routePatches.get(route.props.path);
        if (!set || !set.size) continue;
        if (route.props.children && route.props.children[IS_PATCHED]) continue;
        set.forEach(function (patch) {
          try {
            var res = patch(Object.assign({}, route.props));
            if (res && res.children !== undefined) route.props.children = res.children;
          } catch (e) { log("routePatch:", route.props.path, e && e.message); }
        });
        try { if (route.props.children) route.props.children[IS_PATCHED] = true; } catch (e) {}
      }
    }

    // Splice our registered routes into the (main) route-list array as a nested
    // array at a stable slot (React flattens nested arrays of children).
    function injectRoutes(routeList) {
      if (!routes.size) return;
      var Route = findRoute();
      if (!Route) return;
      var slot = -1;
      for (var i = 0; i < routeList.length; i++) { if (routeList[i] && routeList[i][OUR_ARRAY]) { slot = i; break; } }
      var arr = [];
      arr[OUR_ARRAY] = true;
      routes.forEach(function (entry, path) {
        var inner = React.createElement(entry.component);
        arr.push(React.createElement(Route, Object.assign({ path: path }, entry.props || {}),
          ErrorBoundary ? React.createElement(ErrorBoundary, null, inner) : inner));
      });
      if (slot >= 0) routeList[slot] = arr; else routeList.push(arr);
    }

    // Wrap the router render: its output is a Fragment whose children are the
    // route-list containers; patch each list, inject our routes into the first.
    function handleRender(_args, ret) {
      try {
        if (!ret || !ret.props) return ret;
        var top = ret.props.children;
        var containers = Array.isArray(top) ? top : [top];
        var first = true;
        for (var i = 0; i < containers.length; i++) {
          var c = containers[i];
          if (c && c.props && Array.isArray(c.props.children)) {
            applyPatches(c.props.children);
            if (first) { injectRoutes(c.props.children); first = false; }
          }
        }
        // Render always-on global components (the home bridge) as keyed siblings
        // of the routes so they mount regardless of the active route and reconcile
        // in place across router re-renders (stable key → no re-mount).
        if (globalComponents.size) {
          var extras = [];
          globalComponents.forEach(function (comp, id) {
            try { extras.push(React.createElement(comp, { key: "shg-" + id })); } catch (e) {}
          });
          return React.createElement(React.Fragment, { key: "shg-wrap" }, ret, extras);
        }
      } catch (e) { log("routerHook render:", e && e.message); }
      return ret;
    }

    var routerFiber = null; // the mounted route-declaring fiber, for re-rendering
    function ensurePatched() {
      if (patched || !React) return patched;
      try {
        var rf = getReactRoot(document.getElementById("root"));
        if (!rf) return false;
        var node = findInReactTree(rf, function (n) {
          var t = n && (n.elementType || n.type);
          if (!t) return false;
          if (srcOf(t).indexOf("Settings.Root()") >= 0) return true;
          try { if (t.type && srcOf(t.type).indexOf("Settings.Root()") >= 0) return true; } catch (e) {}
          return false;
        });
        if (!node) return false;
        var et = node.elementType || node.type;
        if (!et || typeof et.type !== "function") return false;
        routerFiber = node;
        if (!et.type.__shelvesPatched) { afterPatch(et, "type", handleRender); log("routerHook: router patched."); }
        patched = true;
        return true;
      } catch (e) { logWarn("ROUTER", "patch failed: " + (e && e.message)); return false; }
    }

    // The route-declaring component is a memoized fiber that captured its render
    // fn at mount (before our patch) and does NOT re-render on navigation — so
    // point the LIVE fiber's `type` at the patched fn, invalidate its memo props
    // (so a reconcile can't bail on it), and force the nearest class ancestor to
    // re-render. That single re-render runs our patched render, which splices our
    // routes into the live route table + applies our patches; react-router then
    // matches them on navigation. Debounced — many addRoute/addPatch calls at boot
    // collapse into one force.
    var forcePending = false;
    function doForce() {
      forcePending = false;
      if (!routerFiber) return;
      try {
        var et = routerFiber.elementType;
        if (et && typeof et.type === "function") {
          routerFiber.type = et.type;
          if (routerFiber.alternate) routerFiber.alternate.type = et.type;
        }
        var stamp = { __shForce: Date.now() };
        routerFiber.memoizedProps = Object.assign({}, stamp, routerFiber.memoizedProps);
        if (routerFiber.alternate) routerFiber.alternate.memoizedProps = Object.assign({}, stamp, routerFiber.alternate.memoizedProps || {});
        var p = routerFiber.return, hops = 0;
        while (p && hops++ < 80) {
          if (p.stateNode && typeof p.stateNode.forceUpdate === "function") { p.stateNode.forceUpdate(); return; }
          p = p.return;
        }
        log("routerHook: no updatable ancestor to force.");
      } catch (e) { log("routerHook force:", e && e.message); }
    }
    function scheduleForce() { if (forcePending) return; forcePending = true; setTimeout(doForce, 0); }

    // The router node may not be mounted the instant a route is registered — poll
    // until the patch lands (idempotent; capped), then force the re-render.
    var tries = 0;
    function ensureWithRetry() {
      if (ensurePatched()) { scheduleForce(); return; }
      if (tries++ < 400) setTimeout(ensureWithRetry, 100);
    }

    return {
      addRoute: function (path, component, props) { log("routerHook.addRoute", path); routes.set(path, { component: component, props: props || {} }); ensureWithRetry(); },
      removeRoute: function (path) { routes.delete(path); },
      addPatch: function (path, patch) { log("routerHook.addPatch", path); if (!routePatches.has(path)) routePatches.set(path, new Set()); routePatches.get(path).add(patch); ensureWithRetry(); return patch; },
      removePatch: function (path, patch) { var s = routePatches.get(path); if (s) s.delete(patch); return patch; },
      // Always-on global components (the plugin's home bridge, which renders
      // elsewhere and PORTALS the shelves into its own mount). Rendered as stable,
      // keyed siblings of the routes in handleRender — so they mount once and
      // reconcile in place (no re-mount, no leaked subscriptions).
      addGlobalComponent: function (a, b) {
        var id, comp;
        if (typeof a === "string") { id = a; comp = b; }
        else if (a && a.component) { id = a.id || ("g" + globalComponents.size); comp = a.component; }
        else { comp = a; id = (a && (a.displayName || a.name)) || ("g" + globalComponents.size); }
        if (!comp) return function () {};
        log("routerHook.addGlobalComponent", id);
        globalComponents.set(id, comp);
        ensureWithRetry();
        return function () { globalComponents["delete"](id); scheduleForce(); };
      },
      removeGlobalComponent: function (a) {
        if (typeof a === "string") { globalComponents["delete"](a); }
        else if (a && a.id) { globalComponents["delete"](a.id); }
        else { globalComponents.forEach(function (v, k) { if (v === a) globalComponents["delete"](k); }); }
        scheduleForce();
      }
    };
  }
  var routerHook = makeRouterHook();

  // ── QAM: register a native tab in the Quick Access Menu ───────────────────
  // The tab-list builder hook returns the tabs array; we append our tab(s) to
  // its output (non-destructive). Overlay panel is the fallback and the
  // immediate path. See installPatch below for the mechanism and its timing.
  var QamHost = (function () {
    var KEY_PREFIX = "shelves-";
    // Native QAM tab is config-driven: the daemon stamps
    // `window.__SHELVES_NATIVE_QAM__ = true` (env SHELVES_NATIVE_QAM=1) before
    // injecting this runtime. Off by default so the deployed state is stable —
    // validate on a non-primary device first; it touches the Steam renderer.
    var NATIVE_QAM_ENABLED = (function () {
      try { return window.__SHELVES_NATIVE_QAM__ === true; } catch (_) { return false; }
    })();
    var specs = {};
    var patched = false;
    var confirmed = false;
    var lastVisible = true;

    // Trip breaker: "armed" is written just before patching and cleared on the
    // first healthy render through our handler. If a boot finds "armed" left
    // over, the previous arm never confirmed (renderer likely died) — trip and
    // refuse the native path until the key is cleared manually. Guarantees at
    // most one bad arm, never a crash loop. All storage access is fail-safe
    // (CEF contexts can deny localStorage).
    var TRIP_KEY = "shelves.nativeQamTrip";
    function tripGet() { try { return window.localStorage.getItem(TRIP_KEY); } catch (_) { return null; } }
    function tripSet(v) { try { window.localStorage.setItem(TRIP_KEY, v); } catch (_) {} }
    function tripClear() { try { window.localStorage.removeItem(TRIP_KEY); } catch (_) {} }
    var tripped = false;
    // A RECENT arm is a legitimate boot double-inject (the renderer reloaded before
    // our first healthy render — common mid-boot), so re-arm cleanly instead of
    // tripping. Only a STALE arm (a genuinely dead previous session) trips. Arms are
    // stamped `armed:<ms>`; a bare `armed` (pre-timestamp runtime) counts as stale.
    var STALE_ARM_MS = 15000;
    // The breaker guards ONLY the sole/owner path, where the webpack UI scan can
    // black-screen. In COEXIST the UI is borrowed from the loader (no scan, no
    // collapse risk), so the breaker must never engage there — otherwise an armed
    // state left by a restart before the QAM first renders would false-trip and
    // silently kill our tab on every later boot.
    if (NATIVE_QAM_ENABLED && !COEXIST) {
      var prior = tripGet();
      if (prior && prior.indexOf("armed") === 0) {
        var armTs = parseInt(prior.split(":")[1] || "0", 10) || 0;
        if (Date.now() - armTs > STALE_ARM_MS) {
          tripSet("tripped:" + Date.now());
          tripped = true;
          log("QAM native: previous arm never confirmed (stale) — TRIPPED. Overlay fallback active; clear localStorage['" + TRIP_KEY + "'] to retry.");
        } else {
          log("QAM native: recent arm (boot re-inject) — re-arming, not tripping.");
        }
      } else if (prior && prior.indexOf("tripped") === 0) {
        tripped = true;
        logError("QAM", "breaker is tripped (" + prior + ") — overlay fallback active; clear localStorage['" + TRIP_KEY + "'] to retry.");
      }
      if (tripped) NATIVE_QAM_ENABLED = false;
    }

    function iconEl(icon) {
      if (icon && icon.$$typeof) return icon;
      if (typeof icon === "string") return h("div", { style: { display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }, dangerouslySetInnerHTML: { __html: icon } });
      return null;
    }
    // Accept BOTH panel shapes: the @deck-shelves/host contract's imperative
    // `render(container)` (framework-agnostic — we host it in a ref'd div), and
    // our React `content` (element or factory), used by the example bundle.
    // Stable host for a spec's imperative render(container). Defined ONCE (not a
    // fresh closure per contentEl call) and keyed by spec.id at the call site, so
    // it reconciles across PanelSlot re-renders instead of remounting — a remount
    // re-runs spec.render and resets the mirrored editor's transient state (a
    // toggle mid-flip, the open side panel) on every slot refresh.
    function SpecRenderHost(props) {
      var spec = props.spec;
      var ref = React.useRef(null);
      React.useEffect(function () {
        if (!ref.current) return undefined;
        var cleanup;
        try { cleanup = spec.render(ref.current); } catch (e) { log("qam panel render:", e && e.message); }
        return typeof cleanup === "function" ? cleanup : undefined;
      }, []);
      return h("div", { ref: ref, style: { width: "100%", height: "100%" } });
    }
    function contentEl(spec) {
      var inner = typeof spec.render === "function"
        ? h(SpecRenderHost, { key: spec.id, spec: spec })
        : (typeof spec.content === "function" ? spec.content() : spec.content);
      return ErrorBoundary ? h(ErrorBoundary, null, inner) : inner;
    }

    // One stable native tab whose icon and panel are LAZY slots: they render
    // whatever panel spec is currently registered, at render time. This makes
    // the whole path order-independent — the tab can enter the tab list at
    // Steam boot (before the bundle loads), and the moment the bundle calls
    // registerPanel the slots re-render with the real Deck Shelves icon and
    // UI. The panel renders Deck Shelves DIRECTLY (never a plugin list).
    var slotListeners = [];
    function notifySlots() {
      for (var i = 0; i < slotListeners.length; i++) {
        try { slotListeners[i](function (n) { return n + 1; }); } catch (e) {}
      }
    }
    // Diagnostic: lets a controlled native-render test force a slot re-render from
    // the debugger after flipping window.__SHELVES_NATIVE_UI__ (see nativeUiOn()).
    try { window.__SHELVES_REFRESH__ = notifySlots; } catch (e) {}
    function useSlotRefresh() {
      var st = React.useState(0);
      React.useEffect(function () {
        slotListeners.push(st[1]);
        return function () {
          var i = slotListeners.indexOf(st[1]);
          if (i >= 0) slotListeners.splice(i, 1);
        };
      }, []);
    }
    function firstSpec() {
      var ids = Object.keys(specs);
      return ids.length ? specs[ids[0]] : null;
    }
    // Deck Shelves' own tab icon (mirrors the plugin's assets/tab-icon.svg:
    // tintable single-colour, reads at ~18px). A registered spec's icon still
    // overrides it the moment the bundle registers a panel.
    var DEFAULT_ICON =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
      '<rect x="3.8" y="7.5" width="3.9" height="11.5" rx="0.8"/>' +
      '<rect x="8.7" y="5" width="3.9" height="14" rx="0.8"/>' +
      '<rect x="14" y="8" width="3.9" height="11" rx="0.8" transform="rotate(-13 15.95 19)"/>' +
      '<rect x="2.4" y="19" width="19.2" height="2.5" rx="0.9"/></svg>';
    function TabIconSlot() {
      useSlotRefresh();
      var s = firstSpec();
      return iconEl((s && s.icon) || DEFAULT_ICON);
    }
    // POST a JSON-RPC call to the local host RPC server (same transport as
    // `host.rpc.call`) — used by the fallback panel's actions.
    function hostRpc(method, args) {
      return fetch(RPC_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: method, args: args == null ? null : args }),
      }).then(function (r) { return r.json(); });
    }
    // Shown in OUR tab when no panel is registered — i.e. the bundle could not be
    // brought up. Host-branded, self-contained (plain elements, no dependency on
    // the discovered Steam UI, which may be part of what failed), strings via I18N.
    // Actions call the daemon over RPC; each degrades quietly if unavailable.
    // Inline SVG (currentColor) so each action reads at a glance and the panel
    // stays self-contained — no external icon font/asset, nothing that could be
    // part of what failed.
    var FALLBACK_ICONS = {
      download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M8 11l4 4 4-4"/><path d="M5 20h14"/></svg>',
      update: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/></svg>',
      logs: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/></svg>',
      auto: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
      back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
      // Tintable ShelvesHub mark: three books on a shelf over a hub node, single-
      // colour (currentColor). Three bigger books (vs the 4-book draft) + the hub
      // (the ShelvesHub identity), tuned to still read at 16px.
      hub: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="2.6" width="3.7" height="11.8" rx="0.7"/><rect x="9.5" y="1" width="3.7" height="13.4" rx="0.7"/><rect x="14" y="3.4" width="3.7" height="11" rx="0.7" transform="rotate(-12 15.85 14.4)"/><rect x="3.3" y="14.4" width="17.4" height="2.1" rx="0.9"/><circle cx="12" cy="19.2" r="1.6"/><circle cx="8.6" cy="22.3" r="1"/><circle cx="12" cy="22.8" r="1"/><circle cx="15.4" cy="22.3" r="1"/><path d="M12 20.5 L9 21.9 M12 20.8 L12 21.9 M12 20.5 L15 21.9" stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round"/></svg>',
    };
    function fbIcon(name) {
      return h("span", {
        key: "i",
        style: { display: "inline-flex", flex: "0 0 16px", width: "16px", height: "16px", opacity: 0.9 },
        dangerouslySetInnerHTML: { __html: FALLBACK_ICONS[name] },
      });
    }
    // A gamepad-focusable clickable: Steam's Focusable (onActivate fires on the A
    // button and on pointer) once it is discovered, else a plain <button>. Same
    // styling either way; Focusable adds Steam's native focus ring so our own
    // items join the gamepad navigation, exactly like the plugin's native controls.
    // Focus ring for the plain (non-DialogButton) path: give the Focusable a ring
    // class the panel's <style> targets. Steam's Focusable applies `focusClassName`
    // while the element holds focus-nav focus; the CSS is rendered INTO the panel
    // (see PanelSlot) so it reaches the QAM document, not SharedJSContext.
    function clickable(onAct, extra, kids) {
      var props = focusableComp
        ? { onActivate: onAct, focusClassName: "shelves-gpfocus" }
        : { onClick: onAct };
      if (extra) for (var k in extra) props[k] = extra[k];
      return React.createElement.apply(React, [focusableComp || "button", props].concat(kids || []));
    }
    function FallbackPanel(props) {
      var onBack = props && props.onBack;
      var st = React.useState(null);
      var busy = st[0], setBusy = st[1];
      // null = still loading the setting; then a boolean mirrors the store.
      var au = React.useState(null);
      var autoUpdate = au[0], setAutoUpdate = au[1];
      // null = hub view; an array = the log viewer showing merged daemon+runtime lines.
      var lg = React.useState(null);
      var logs = lg[0], setLogs = lg[1];
      function viewLogs() {
        setBusy("logs");
        hostRpc("getLogs", 200).then(function (r) {
          setBusy(null);
          setLogs(r && r.ok && Array.isArray(r.result) ? r.result : []);
        }, function () { setBusy(null); setLogs([]); });
      }
      React.useEffect(function () {
        var alive = true;
        hostRpc("getConfig").then(function (r) {
          if (!alive) return;
          var v = r && r.ok && r.result && typeof r.result.auto_update === "boolean" ? r.result.auto_update : false;
          setAutoUpdate(v);
        }, function () { if (alive) setAutoUpdate(false); });
        return function () { alive = false; };
      }, []);
      var on = autoUpdate === true;
      function run(id, method) {
        if (method === "getLogs") { viewLogs(); return; }
        setBusy(id);
        hostRpc(method).then(function () { setBusy(null); }, function () { setBusy(null); });
      }
      function applyAuto(next) {
        if (busy) return;
        setAutoUpdate(next); setBusy("auto");
        hostRpc("setAutoUpdate", next).then(function (r) {
          setBusy(null);
          if (r && r.ok && r.result && typeof r.result.auto_update === "boolean") setAutoUpdate(r.result.auto_update);
        }, function () { setBusy(null); setAutoUpdate(!next); });
      }

      // ── Log viewer ── merged daemon + runtime lines (getLogs), each parsed
      // from `[LEVEL] [ts] [scope] msg` into a badged row (level colour + scope),
      // so it reads like the plugin's Advanced → Logs. Newest first, scrollable.
      if (logs !== null) {
        var parseLine = function (line) {
          var m = /^\[(\w+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+([\s\S]*)$/.exec(String(line));
          return m ? { level: m[1].toUpperCase(), ts: m[2], scope: m[3], msg: m[4] }
                   : { level: "INFO", ts: "", scope: "", msg: String(line) };
        };
        var logRow = function (line, i) {
          var p = parseLine(line);
          var lb = LOG_LEVEL_BG[p.level] || "#64748b";
          var sc = LOG_SCOPE_COLOR[p.scope] || "rgba(255,255,255,0.14)";
          return h("div", { key: "l" + i, style: { display: "flex", gap: "6px", alignItems: "baseline", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: "11px", lineHeight: "1.35", fontFamily: "monospace" } },
            h("span", { style: { flex: "0 0 auto", background: lb, color: "#04121f", padding: "0 4px", borderRadius: "2px", fontWeight: "800" } }, p.level),
            p.scope ? h("span", { style: { flex: "0 0 auto", background: sc, color: "#04121f", padding: "0 4px", borderRadius: "2px", fontWeight: "700" } }, p.scope) : null,
            h("span", { style: { flex: "1 1 auto", color: "rgba(255,255,255,0.88)", wordBreak: "break-word", whiteSpace: "pre-wrap" } }, p.msg),
            p.ts ? h("span", { style: { flex: "0 0 auto", color: "rgba(255,255,255,0.4)" } }, p.ts.slice(11)) : null);
        };
        var rows = logs.length
          ? logs.slice().reverse().map(logRow)
          : [h("div", { key: "empty", style: { opacity: 0.6, fontSize: "13px", padding: "8px 0" } }, I18N.t("logs_empty"))];
        return h("div", { style: { padding: "12px 14px", display: "flex", flexDirection: "column", height: "100%", boxSizing: "border-box" }, "data-fb": "logs-view" },
          h("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", flex: "0 0 auto" } },
            clickable(function () { setLogs(null); }, { "data-fb": "logs-back", style: { display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "32px", borderRadius: "4px", background: "rgba(255,255,255,0.08)", cursor: "pointer", border: "none" } }, [fbIcon("back")]),
            h("div", { style: { fontSize: "16px", fontWeight: "700", flex: "1 1 auto" } }, I18N.t("action_logs")),
            clickable(function () { viewLogs(); }, { "data-fb": "logs-refresh", style: { fontSize: "12px", padding: "6px 10px", borderRadius: "4px", background: "rgba(255,255,255,0.08)", cursor: "pointer", border: "none", color: "#fff" } }, [I18N.t("logs_refresh")])),
          h("div", { style: { flex: "1 1 auto", overflowY: "auto", minHeight: "0" } }, rows));
      }

      // ── Native Steam components (theme-aware, gamepad-focusable, native focus
      // ring). Discovery is off the render path (idle), so rendering here only
      // reads cached components — no scan on the render path. Falls through to the
      // plain/Focusable-wrapped panel below when discovery came up empty. ──
      // Native hub — built ONLY from primitives the bundle itself renders in this
      // same injected tab (DialogButton, ToggleField): those are proven to mount
      // here. ButtonItem/PanelSection/PanelSectionRow are deliberately NOT used —
      // the bundle never renders them in the QAM, and mounting them in the injected
      // panel collapses the Steam UI (silent main-thread stall, no throw).
      var DB = UI.DialogButton, TF = UI.ToggleField;
      if (nativeUiOn() && DB && TF) {
        var iconLabel = function (icon, key) {
          return h("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" } }, fbIcon(icon), h("span", null, I18N.t(key)));
        };
        var actBtn = function (id, icon, key, method) {
          return h(DB, {
            key: id, "data-native": "button",
            disabled: !!busy && busy !== id,
            style: { width: "100%", marginTop: "8px" },
            onClick: function () { if (!busy) run(id, method); },
          }, iconLabel(icon, key));
        };
        return h("div", { style: { padding: "12px 14px" }, "data-native": "section" },
          onBack
            ? h("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" } },
                h(DB, { "data-native": "button", style: { flex: "0 0 auto", width: "40px", minWidth: "0", maxWidth: "40px", padding: "6px 0", boxSizing: "border-box" }, onClick: onBack }, fbIcon("back")),
                h("div", { style: { fontSize: "18px", fontWeight: "700" } }, I18N.t("hub_title")))
            : h("div", { style: { fontSize: "18px", fontWeight: "700", marginBottom: "2px" } }, I18N.t("hub_title")),
          onBack ? null : h("div", { style: { fontSize: "13px", opacity: 0.7, margin: "2px 0 8px" } }, I18N.t("unavailable_body")),
          actBtn("download", "download", "action_download", "populateBundle"),
          actBtn("update", "update", "action_update_hub", "selfUpdate"),
          actBtn("logs", "logs", "action_logs", "getLogs"),
          // The toggle row goes edge-to-edge (breaks out of the section's horizontal
          // padding) so the focus highlight reaches the QAM edge, exactly like the
          // plugin's rows. The label/switch are then inset by padding the Field's
          // CONTENT below (via the discovered gamepadDialog Field class), NOT this
          // wrapper — so the highlight stays end-to-end while the content is spaced.
          h("div", { className: "shelves-toggle-row", style: { marginTop: "10px", marginLeft: "-14px", marginRight: "-14px" } }, h(TF, {
            label: I18N.t("action_auto_update"),
            checked: on, disabled: !!busy && busy !== "auto",
            onChange: function (v) { applyAuto(!!v); },
          })));
      }

      // ── Panel (self-contained plain elements) ──
      var row = {
        display: "flex", alignItems: "center", gap: "10px",
        width: "100%", boxSizing: "border-box", padding: "10px 14px",
        marginTop: "8px", textAlign: "left", border: "none",
        borderRadius: "4px", fontSize: "14px", color: "#fff",
      };
      function actionBtn(id, icon, key, method, primary) {
        return clickable(function () { if (!busy) run(id, method); }, {
          key: id,
          "data-fb": id,
          style: Object.assign({}, row, {
            cursor: busy ? "default" : "pointer",
            opacity: busy && busy !== id ? 0.5 : 1,
            background: primary ? "#1a9fff" : "rgba(255,255,255,0.08)",
          }),
        }, [fbIcon(icon), h("span", { key: "t", style: { flex: "1 1 auto" } }, I18N.t(key))]);
      }
      function toggleRow() {
        return clickable(function () { applyAuto(!on); }, {
          key: "auto", "data-fb": "auto", "data-on": on ? "1" : "0",
          style: Object.assign({}, row, { cursor: busy ? "default" : "pointer", background: "rgba(255,255,255,0.08)" }),
        }, [
          fbIcon("auto"),
          h("span", { key: "t", style: { flex: "1 1 auto" } }, I18N.t("action_auto_update")),
          h("span", {
            key: "sw",
            style: { flex: "0 0 auto", width: "38px", height: "22px", borderRadius: "11px", position: "relative", background: on ? "#1a9fff" : "rgba(255,255,255,0.25)" },
          }, h("span", { style: { position: "absolute", top: "2px", left: on ? "18px" : "2px", width: "18px", height: "18px", borderRadius: "50%", background: "#fff" } }))
        ]);
      }
      var titleRow = onBack
        ? h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
            clickable(onBack, {
              "data-fb": "back", title: I18N.t("action_back"),
              style: { flex: "0 0 auto", width: "28px", height: "28px", border: "none", borderRadius: "4px", background: "rgba(255,255,255,0.08)", color: "#fff", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" },
            }, [fbIcon("back")]),
            h("div", { style: { fontSize: "18px", fontWeight: "700" } }, I18N.t("hub_title")))
        : h("div", { style: { fontSize: "18px", fontWeight: "700" } }, I18N.t("hub_title"));
      return h(
        "div",
        { style: { padding: "16px 15px 10px" }, "data-fb-panel": "1" },
        titleRow,
        onBack ? null : h("div", { style: { fontSize: "13px", opacity: 0.7, margin: "4px 0 12px" } }, I18N.t("unavailable_body")),
        actionBtn("download", "download", "action_download", "populateBundle", true),
        actionBtn("update", "update", "action_update_hub", "selfUpdate"),
        actionBtn("logs", "logs", "action_logs", "getLogs"),
        toggleRow()
      );
    }
    // Our tab: the plugin's editor when present, plus a ShelvesHub row pinned at
    // the end that opens the host's hub view (the same actions as the fallback) —
    // so the host's own options are reachable even while Deck Shelves is loaded.
    function PanelSlot() {
      useSlotRefresh();
      var hub = React.useState(false);
      var showHub = hub[0], setShowHub = hub[1];
      var s = firstSpec();
      var body;
      // No registered panel → the hub view IS the content (the fallback).
      if (!s) body = h(FallbackPanel, null);
      // Hub view opened from the plugin editor → show it with a back button.
      else if (showHub) body = h(FallbackPanel, { onBack: function () { setShowHub(false); } });
      // Plugin editor + a ShelvesHub button pinned at the end that opens the hub
      // view (the host's own options, reachable while Deck Shelves is loaded).
      else {
        var openHub = function () { setShowHub(true); };
        var hubBtn = (nativeUiOn() && UI.DialogButton)
          ? h(UI.DialogButton, { "data-fb": "open-hub", onClick: openHub, style: { width: "100%", marginTop: "8px" } },
              h("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" } }, fbIcon("hub"), h("span", null, I18N.t("hub_title"))))
          : clickable(openHub, {
              "data-fb": "open-hub",
              style: {
                flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center",
                gap: "8px", width: "100%", boxSizing: "border-box", padding: "10px 14px",
                border: "none", borderTop: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.05)", color: "#fff", cursor: "pointer", fontSize: "13px",
              },
            }, [fbIcon("hub"), h("span", { key: "t" }, I18N.t("hub_title"))]);
        // Natural flow (no flex column, no overflow): the editor keeps its own
        // height and the hub button sits AFTER it — so the button never overlaps
        // the editor, and no overflow ancestor clips the plugin's IntersectionObserver
        // (useIsActiveQamTab). The QAM panel does the scrolling, like the loader.
        // Inset the ShelvesHub button so it aligns with the plugin's own rows and
        // our hub-screen items (which sit inside the section's 14px padding), rather
        // than sitting flush against the QAM edge.
        body = h("div", null, contentEl(s), h("div", { style: { padding: "0 14px" } }, hubBtn));
      }
      var inner = ErrorBoundary ? h(ErrorBoundary, null, body) : body;
      // Focus ring: Steam applies `.gpfocus` to the focused native control but draws
      // NO ring for our injected panel (it sits outside Steam's own FocusRing
      // ancestor). We render the ring CSS as part of the panel so it lands in the
      // QAM document (NOT SharedJSContext, where a head-injected <style> would go
      // and never reach these nodes), scoped to `.shelves-panel`.
      // Ring ONLY buttons (DialogButton lacks a native focus visual in our injected
      // panel) and our own plain clickables (.shelves-gpfocus). Toggles, collapsible
      // titles and other native controls already get Steam's own row highlight
      // (a background, not a ring) — ringing them too looks doubled-up/odd.
      var ringCss =
        ".shelves-panel .DialogButton.gpfocus,.shelves-panel .shelves-gpfocus{" +
        "box-shadow:0 0 0 2px rgba(255,255,255,.95),0 0 12px 2px rgba(90,160,255,.6)!important;" +
        "border-radius:4px;}";
      // Our edge-to-edge toggle row's Field has 0 horizontal padding, so its label/
      // switch would touch the QAM edges. Pad the Field's CONTENT (not the wrapper):
      // the highlight/background still reaches the QAM edge, only the content insets.
      // The Field class is Steam's own gamepadDialog CSS class — discovered from the
      // webpack in sole mode (no loader), or borrowed from the loader in coexist.
      try {
        var _gpdCls = null;
        try {
          _gpdCls = Steam.findModule(function (e) {
            return e && typeof e === "object" && typeof e.Field === "string" &&
              typeof e.GamepadDialogContent === "string" && typeof e.StandardPadding === "string";
          });
        } catch (e) {}
        var _fieldCls = (_gpdCls && _gpdCls.Field) ||
          (window.DFL && window.DFL.gamepadDialogClasses && window.DFL.gamepadDialogClasses.Field) || "";
        if (_fieldCls) ringCss += ".shelves-panel .shelves-toggle-row ." + _fieldCls +
          "{padding-left:14px!important;padding-right:14px!important;}";
      } catch (e) {}
      var styleEl = h("style", { "data-shelves": "ring" }, ringCss);
      // Wrap the panel in Steam's Focusable so it joins gamepad-focus navigation
      // (the mirrored editor's controls and ours) — exactly how the loader wraps its
      // plugin view. Bare (touch still works) until Focusable is available.
      return focusableComp
        ? h(focusableComp, { className: "shelves-panel", style: { height: "100%" } }, styleEl, inner)
        : h("div", { className: "shelves-panel", style: { height: "100%" } }, styleEl, inner);
    }
    // A registered tab needs its key present in Steam's `QuickAccessTab` enum:
    // `pt` derives the panel class as `tab_${QuickAccessTab[key]}` and the tab
    // strip's focus/visibility logic keys off the same enum. An unregistered
    // (string) key renders as `tab_undefined` and is not treated as a
    // first-class tab (focus of hidden tabs misbehaves). So we register a
    // numeric key, exactly as other hosts do (their tab sits at 999).
    //
    // The KEY is only the tab's identity (kept distinct from the loader's 999);
    // the POSITION in the strip is set by insertAfterKey below, NOT by this value.
    // To change it: edit `DEFAULT_TAB_KEY` (one place), or — without touching this
    // file — set `window.__SHELVES_QAM_KEY__` (a number) before injection.
    var DEFAULT_TAB_KEY = 900;
    var NATIVE_TAB_KEY = (function () {
      try {
        if ("__SHELVES_QAM_KEY__" in window && typeof window.__SHELVES_QAM_KEY__ === "number") return window.__SHELVES_QAM_KEY__;
      } catch (e) {}
      return DEFAULT_TAB_KEY;
    })();
    var NATIVE_TAB_NAME = "ShelvesHub";
    function tabEnum() {
      try { if (window.DFL && window.DFL.QuickAccessTab) return window.DFL.QuickAccessTab; } catch (e) {}
      // Exact known shape first, then a value-INDEPENDENT bidirectional-enum match
      // (survives a Steam enum-value change; the sole host has no DFL to fall back on).
      return (
        Steam.findModuleExport(function (m) {
          try { return m && m.Notifications === 0 && m.Settings === 4 && m.Help === 6; } catch (e) { return false; }
        }) ||
        Steam.findModuleExport(function (m) {
          try {
            return m && typeof m === "object"
              && typeof m.Notifications === "number"
              && typeof m.Settings === "number"
              && typeof m.Help === "number"
              && m[m.Settings] === "Settings";
          } catch (e) { return false; }
        })
      );
    }
    function registerTabEnum() {
      try {
        var e = tabEnum();
        if (!e) { log("QAM enum NOT found — our tab would render as tab_undefined."); return; }
        if (e[NATIVE_TAB_KEY] === undefined) {
          e[NATIVE_TAB_KEY] = NATIVE_TAB_NAME;
          e[NATIVE_TAB_NAME] = NATIVE_TAB_KEY;
          log("QAM enum registered: key " + NATIVE_TAB_KEY + " = " + NATIVE_TAB_NAME + ".");
        }
      } catch (err) { logWarn("QAM", "registerTabEnum error: " + (err && err.message)); }
    }

    function buildTab() {
      return {
        key: NATIVE_TAB_KEY,
        strTitle: "Deck Shelves",
        title: h(React.Fragment, null),
        tab: h(TabIconSlot, null),
        panel: h(PanelSlot, null),
        vrLocation: "quick-access-menu",
        __shelvesTab: true,
        initialVisibility: lastVisible,
      };
    }

    // Position: sit right AFTER Steam's Performance tab, so we are always just
    // below Performance and above any lower tab (other hosts' tabs included,
    // which append at the end). Configurable: set `window.__SHELVES_QAM_AFTER__`
    // to another QuickAccessTab key, or to null to append at the very end.
    var NATIVE_TAB_AFTER = 5; // right AFTER Steam's Performance tab (QuickAccessTab.Perf) and thus before another host's tab (those append at the end). With the user's hidden tabs this reads as "just before the loader's tab". Override with window.__SHELVES_QAM_AFTER__.
    function insertAfterKey() {
      try { if ("__SHELVES_QAM_AFTER__" in window) return window.__SHELVES_QAM_AFTER__; } catch (e) {}
      return NATIVE_TAB_AFTER;
    }
    var cachedTab = null;
    function pushTab(tabs) {
      // Idempotent: if our tab is already in this list, only refresh its
      // visibility to track the menu's open/closed state — never insert twice.
      for (var j = 0; j < tabs.length; j++) {
        if (tabs[j] && tabs[j].key === NATIVE_TAB_KEY) {
          if (typeof tabs[j].qAMVisibilitySetter === "function") { try { tabs[j].qAMVisibilitySetter(lastVisible); } catch (e) {} }
          else { tabs[j].initialVisibility = lastVisible; }
          return;
        }
      }
      // Reuse ONE tab object (and its panel/icon elements) across renders. The
      // list is rebuilt fresh on every QAM render, so building a NEW tab each time
      // hands Steam a new panel element every render — remounting the mirrored
      // editor, resetting toggles/side panel, and preventing gamepad focus from
      // settling. the loader adds its tab once; we keep ours stable the same way.
      if (!cachedTab) cachedTab = buildTab();
      var tab = cachedTab;
      tab.initialVisibility = lastVisible;
      // Position: right after Steam's Performance tab, so we sit ahead of any
      // tab that is appended at the end of the list (later additions land last).
      var after = insertAfterKey(), at = tabs.length;
      if (after != null) {
        for (var i = 0; i < tabs.length; i++) { if (tabs[i] && tabs[i].key === after) { at = i + 1; break; } }
      }
      tabs.splice(at, 0, tab); // insert in place (array mutable; element props may be frozen)
      if (!confirmed) { confirmed = true; tripClear(); logInfo("QAM", "tab inserted, healthy."); }
    }

    // Reach the tabs array from a render output and push our tab. The array
    // lives in the output of a deeper component (marked by `onFocusNavDeactivated`),
    // not in the BrowserView's direct return, so we wrap that component's type
    // ONCE — as a real function (never Object.assign on a plain function, which
    // yields a non-callable object → the historical black screen). A memo is
    // rewrapped as a fresh memo whose `.type` is our function. Wrappers are
    // cached on the original so we wrap each component exactly once.
    var wrapCache = typeof WeakMap === "function" ? new WeakMap() : null;
    function tabWrapper(innerFn) {
      var w = function () {
        var out = innerFn.apply(this, arguments);
        try {
          var node = findInReactTree(out, function (x) { return x && x.props && Array.isArray(x.props.tabs); });
          if (node) pushTab(node.props.tabs);
        } catch (e) {}
        return out;
      };
      // Report the original's source and carry its props (Steam matches
      // components by `type.toString()`). Assigning onto a function keeps it
      // callable — the non-callable trap is only `Object.assign({}, fn)`.
      try { Object.assign(w, innerFn); } catch (e) {}
      try { w.toString = function () { return innerFn.toString(); }; } catch (e) {}
      w.__shelvesTabWrap = true;
      return w;
    }
    // True when a component carries another patcher's marker (a foreign wrap):
    // any own enumerable key that reads like a patch/wrap marker but isn't ours.
    // Name-agnostic on purpose, so we never double-wrap a component another host
    // already wrapped — double-wrapping breaks that host's own composite child
    // resolution (observed: it times out and yields `{}` → React error #31 →
    // the Steam UI tree unmounts).
    function foreignWrapped(fn) {
      if (!fn) return false;
      try {
        for (var k in fn) { if (k !== "__shelvesTabWrap" && /patch|wrapped/i.test(k)) return true; }
        var inner = fn.type;
        if (inner && typeof inner === "object") { for (var k2 in inner) { if (k2 !== "__shelvesTabWrap" && /patch|wrapped/i.test(k2)) return true; } }
      } catch (e) {}
      return false;
    }
    function injectTabs(ret) {
      // Fast path: tabs already in this output.
      var direct = findInReactTree(ret, function (x) { return x && x.props && Array.isArray(x.props.tabs); });
      if (direct) { pushTab(direct.props.tabs); return; }
      // Otherwise wrap the component whose output produces the tab list.
      var host = findInReactTree(ret, function (n) { return n && n.props && n.props.onFocusNavDeactivated && n.type; });
      if (!host) return;
      var orig = host.type;
      if (orig.__shelvesTabWrap || (orig.type && orig.type.__shelvesTabWrap)) return; // already ours
      // Chain our tab-append after whatever already wraps this component (another
      // host may have wrapped it first): on render, its wrapper adds its tab(s),
      // then ours adds ours. The earlier React #31 was NOT this double-wrap — it
      // was the heavy UI discovery blocking the main thread (now skipped in
      // coexistence), so chaining here is safe and additive. `foreignWrapped`
      // stays available for diagnostics.
      void foreignWrapped;
      if (wrapCache && wrapCache.has(orig)) { host.type = wrapCache.get(orig); return; }
      var wrapped;
      if (typeof orig === "function") {
        wrapped = tabWrapper(orig);
      } else if (orig && typeof orig.type === "function" && orig.$$typeof) {
        // React.memo/forwardRef: clone as a valid memo carrying ALL of the
        // original's props, with our wrapped inner function as `.type`.
        wrapped = Object.assign({}, orig);
        wrapped.type = tabWrapper(orig.type);
        wrapped.__shelvesTabWrap = true;
      } else {
        return; // unknown shape — never risk an invalid component
      }
      if (wrapCache) wrapCache.set(orig, wrapped);
      host.type = wrapped;
    }

    // The native mechanism — safe by construction. The tab-list *builder*
    // export is a sealed webpack getter (non-writable, non-configurable), so it
    // cannot be wrapped. The QAM *consumer* — the `QuickAccessMenuBrowserView`
    // React.memo — has a WRITABLE `.type`, so we wrap that. On each render we
    // locate the node carrying `props.tabs` in the returned element tree and
    // PUSH our tab onto that array. Nothing else: no component-type cloning, no
    // tree-patcher, no live-fiber surgery — those were the black-screen vectors
    // (on-device 2026-07-23, see internal notes/qam-native-validation.md). We only
    // add one element to a plain array, exactly what a native tab is.
    //
    // Timing: a mounted memo holds its pre-patch type, so this must be wrapped
    // BEFORE the QAM first mounts. The preload path (Page.addScriptToEvaluate-
    // OnNewDocument) runs this runtime at document-start, ahead of the mount;
    // installPatchWithRetry polls until the BrowserView module loads. Without
    // preload (late daemon injection) the tab waits for the next QAM mount; the
    // overlay panel is the immediate fallback either way.
    function installPatch() {
      if (patched || !React) return patched;
      try {
        var mod = Steam.findModuleByExport(function (e) {
          try { return e && e.type && typeof e.type === "function" && e.type.toString().indexOf("QuickAccessMenuBrowserView") >= 0; } catch (_) { return false; }
        });
        if (!mod) return false; // consumer chunk not loaded yet — retry
        var bv = Object.values(mod).find(function (e) {
          try { return e && e.type && e.type.toString && e.type.toString().indexOf("QuickAccessMenuBrowserView") >= 0; } catch (_) { return false; }
        });
        var embedded = Object.values(mod).find(function (e) {
          try { return e && e.type && e.type.toString && e.type.toString().indexOf("QuickAccessMenuEmbedded") >= 0; } catch (_) { return false; }
        });
        if (!bv || typeof bv.type !== "function") return false;
        if (bv.type.__shelvesPatched) { patched = true; return true; }
        // Register our key so the tab is first-class (class + focus/visibility).
        registerTabEnum();
        // The breaker is armed by the RISKY operations only — the handler's live
        // render (below) and the mounted-consumer re-point — NOT here at patch
        // install. Arming at install left the breaker armed on every boot until the
        // user first OPENED the QAM (the only place it confirmed); a reload before
        // that (e.g. a Steam restart) then read a stale arm and false-tripped,
        // silently killing the tab on all later boots. Arming around the actual
        // render means a boot that never opens the QAM never arms, so it can't
        // false-trip — while a render that truly tears the UI down still leaves a
        // stale arm that trips the next boot.
        var handler = function (args, ret) {
          try {
            // Arm just before our first live render into the QAM tree; a healthy
            // insert clears it (injectTabs → confirmed). Sole/owner only — COEXIST
            // borrows the UI and cannot collapse.
            if (!confirmed && !COEXIST) tripSet("armed:" + Date.now());
            if (args && args[0] && typeof args[0].visible !== "undefined") lastVisible = args[0].visible;
            injectTabs(ret);
          } catch (e) { logWarn("QAM", "append error (ignored): " + (e && e.message)); }
          return ret;
        };
        // The menu has two consumers that both render the tab list; patch each
        // that is present so the tab shows in either presentation.
        afterPatch(bv, "type", handler);
        if (embedded && typeof embedded.type === "function" && !embedded.type.__shelvesPatched) {
          afterPatch(embedded, "type", handler);
        }
        patched = true;
        log("QAM native: consumer patched.");
        // Late injection: a consumer may already be mounted, holding its pre-
        // patch type, so the wrap above would not take effect until a remount.
        // Re-point the live fiber's `type` to the now-patched inner function
        // (reached via `elementType`; the fiber's own `type` is a wrapper), so
        // an already-open menu picks up the tab without waiting for a remount.
        // This re-point synchronously mutates a LIVE fiber. It was once believed
        // unsafe in OWNER (sole-host) mode — a late inject there black-screened —
        // but that collapse was the boot-timing/scan issue (the runtime running
        // during Steam's first paint), since resolved by injecting post-settle. A
        // re-point on an ALREADY-SETTLED renderer is safe in BOTH modes — verified
        // on-device in sole mode (tab appears, no UI collapse) and in the scenario
        // harness. The daemon injects post-settle, exactly the safe window, so
        // enable it by default; opt out with `window.__SHELVES_FIBER_REPOINT__ = false`.
        var doRepoint = true;
        try { if (window.__SHELVES_FIBER_REPOINT__ === false) doRepoint = false; } catch (e) {}
        if (doRepoint) { patchMountedConsumer(bv, embedded); }
        else { log("QAM native: mounted re-point OFF (opt out via __SHELVES_FIBER_REPOINT__=false)."); }
      } catch (e) {
        tripClear();
        logWarn("QAM", "installPatch failed: " + (e && e.message));
      }
      return patched;
    }

    // Reach the live fiber for an already-mounted consumer and re-point its
    // `type` to the patched inner function. Scoped to that one fiber node (and
    // its alternate), so nothing shared is mutated. No-op if the menu has not
    // mounted yet (the wrap above covers the first mount then).
    function patchMountedConsumer(bv, embedded) {
      try {
        var root = getReactRoot(document.getElementById("root"));
        if (!root) return;
        var node = findInReactTree(root, function (n) {
          return n && (n.elementType === bv || (embedded && n.elementType === embedded));
        });
        if (node && node.elementType && node.elementType.type) {
          // Re-point only prepares the fiber; the actual render (and any collapse
          // risk) happens later through the handler, which arms itself. Arming here
          // would leave a lingering arm when the QAM is closed (no render follows),
          // re-creating the false-trip. So do NOT arm here.
          node.type = node.elementType.type;
          if (node.alternate) node.alternate.type = node.type;
          log("QAM native: re-pointed already-mounted consumer.");
        }
      } catch (e) { log("QAM mounted re-point skipped:", e && e.message); }
    }

    // The builder's chunk loads at some point during Steam boot and the QAM
    // mounts right after — so when this runtime evaluates early (preload
    // path), poll until the builder appears. The append is idempotent and
    // non-destructive, so retrying is safe; if the QAM mounts before we won
    // the race, the tab simply waits for the next Steam UI boot.
    var patchAttempts = 0;
    function installPatchWithRetry() {
      if (patched || !React) return;
      if (installPatch()) return;
      patchAttempts++;
      if (patchAttempts === 1) log("QAM native: waiting for the tab-list builder…");
      if (patchAttempts < 1200) setTimeout(installPatchWithRetry, 50);
      else log("QAM native: builder never appeared — overlay only.");
    }
    if (NATIVE_QAM_ENABLED) installPatchWithRetry();
    // Discover Steam's native UI components off the render path, on a timer ~1.5s
    // after inject (once the plugin's boot has settled), then re-render the slots so
    // the panel + our items render natively (native look + focus ring). CHUNKED —
    // one scan per timer tick (ensureUiChunked) — because a single scan is safe
    // (~25ms) but several back-to-back block the main thread long enough to starve
    // the running plugin and collapse the Steam UI (measured on-device: 3–48ms/step).
    if (NATIVE_QAM_ENABLED && !focusableComp) {
      try {
        setTimeout(function () {
          // Coexist borrowed UI from the loader already (uiReady) → just adopt
          // Focusable, NO webpack scan. Otherwise (sole host / no lib) discover it
          // chunked. The scan on the inject path is what collapsed the Steam UI.
          if (uiReady) { ensureFocusable(); notifySlots(); }
          else ensureUiChunked(function () { ensureFocusable(); notifySlots(); });
        }, 1500);
      } catch (e) {}
    }

    function registerPanel(spec) {
      if (!spec || typeof spec.id !== "string") throw new Error("[shelves-host] qam.registerPanel: { id, title, icon, content } required");
      specs[spec.id] = spec;
      if (NATIVE_QAM_ENABLED) { installPatchWithRetry(); notifySlots(); }
      log("QAM panel registered:", spec.id, NATIVE_QAM_ENABLED ? (patched ? "(native)" : "(patch pending)") : "(native disabled)");
      return function () { delete specs[spec.id]; if (NATIVE_QAM_ENABLED) notifySlots(); };
    }
    // Diagnostic surface: which QAM path is live, and why.
    function mode() {
      if (tripped) return "tripped";
      if (NATIVE_QAM_ENABLED && patched) return confirmed ? "native" : "native-arming";
      return "overlay";
    }
    return { registerPanel: registerPanel, mode: mode, _specs: specs, _isNative: function () { return patched; } };
  })();

  // ── HostApi assembly ──────────────────────────────────────────────────────
  var mountHandlers = [], unmountHandlers = [];
  var host = {
    __shelvesRuntime: true,
    version: HOST_API_VERSION,
    // Steam's React stack, discovered from webpack in owner mode — the bundle's
    // react / react-dom / jsx-runtime shims read these from `__SHELVES_HOST__`
    // (no loader-shaped globals are published; the host stays neutral).
    React: React,
    ReactDOM: ReactStack.ReactDOM,
    jsx: ReactStack.jsx,
    ui: UI,
    ErrorBoundary: ErrorBoundary,
    // Shapes conform to the @deck-shelves/host contract directly (so the
    // plugin's resolveHost() uses this object as the HostApi with no interim
    // adapter). The legacy shapes (register() no-arg, addRoute/removeRoute,
    // notifications.send) are kept for older bundles that still bridge.
    lifecycle: {
      register: function (plugin) { log("lifecycle.register", plugin && plugin.name); return { dispose: function () {} }; },
      onMount: function (cb) { if (typeof cb === "function") { mountHandlers.push(cb); cb(); } },
      onUnmount: function (cb) { if (typeof cb === "function") unmountHandlers.push(cb); },
    },
    rpc: {
      call: function (method, args) {
        return fetch(RPC_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method: method, args: args == null ? null : args }) })
          .then(function (res) { if (!res.ok) throw new Error("rpc.call(" + method + ") HTTP " + res.status); return res.json(); })
          .then(function (j) { if (!j.ok) throw new Error("rpc.call(" + method + "): " + j.error); return j.result; });
      },
    },
    // The concrete router hook — the plugin resolves this (falling back from a
    // loader's hook) to register its screens and patch the home. Exposed both as
    // `routerHook` (what the plugin looks for by name) and behind `routes`.
    routerHook: routerHook,
    routes: {
      register: function (path, component) {
        routerHook.addRoute(path, component);
        return { dispose: function () { routerHook.removeRoute(path); } };
      },
      addRoute: function (path, component, props) { routerHook.addRoute(path, component, props); },
      removeRoute: function (path) { routerHook.removeRoute(path); },
      addPatch: function (path, patch) { return routerHook.addPatch(path, patch); },
      removePatch: function (path, patch) { return routerHook.removePatch(path, patch); },
    },
    notifications: {
      toast: function (opts) { opts = opts || {}; this.send(opts.title || "", opts.body || "", opts.durationMs); },
      send: function (title, body) {
        try { if (window.SteamClient && window.SteamClient.Notifications) { window.SteamClient.Notifications.DisplayNotification(title, body); return; } } catch (e) {}
        log("notify:", title, "-", body);
      },
    },
    platform: {
      getOSVersion: function () { return navigator.userAgent; },
      checkCompatibility: function () { return typeof window !== "undefined"; },
      navigateToApp: function (appId) {
        try { if (window.SteamClient && window.SteamClient.Apps) { window.SteamClient.Apps.RunGame(String(appId), "", -1, 100); return; } } catch (e) {}
        log("navigateToApp", appId);
      },
    },
    // Self-install of a PLUGIN update: the daemon obtains the release asset and swaps
    // the injected bundle, so the plugin's update UX can offer "Install" (not just
    // "Download"). applyUpdate reloads once the swap succeeds, so the daemon re-injects
    // the new bundle and the plugin re-boots on it.
    updates: {
      canSelfInstall: function () { return true; },
      applyUpdate: function (release) {
        return fetch(RPC_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method: "applyUpdate", args: release == null ? null : release }) })
          .then(function (res) { if (!res.ok) throw new Error("applyUpdate HTTP " + res.status); return res.json(); })
          .then(function (j) { if (!j.ok) throw new Error("applyUpdate: " + j.error); try { window.location.reload(); } catch (e) {} });
      },
    },
    qam: QamHost,
    _steam: Steam,
  };

  // The native QAM tab's registration surface — the @deck-shelves/host contract's
  // `window.__SHELVES_QAM__` (a `HostQam`), exposed on its own global. Unlike
  // `__SHELVES_HOST__` this never participates in host selection, so a Deck
  // Shelves running under ANOTHER loader (which owns the home) can still populate
  // THIS host's native tab by registering a panel here — the one safe hook in
  // coexistence. In owner mode it is the same object as `__SHELVES_HOST__.qam`.
  // Idempotent: the first runtime to patch the tab stays the registration target,
  // so a panel registered against it always feeds the tab that is actually live.
  try { if (!window.__SHELVES_QAM__) window.__SHELVES_QAM__ = host.qam; } catch (e) {}
  // Drain panels a Deck Shelves registered before this bridge existed: when it
  // boots first (under another loader) it leaves them on `__SHELVES_QAM_PENDING__`.
  // Registering against `__SHELVES_QAM__` (the idempotent bridge) guarantees they
  // feed the tab that is actually live, whichever runtime patched it.
  try {
    var pend = window.__SHELVES_QAM_PENDING__, q = window.__SHELVES_QAM__;
    if (q && pend && pend.length) { for (var pi = 0; pi < pend.length; pi++) { try { q.registerPanel(pend[pi]); } catch (e) {} } pend.length = 0; }
  } catch (e) {}

  // Build the loader-style class map: the array of Steam CSS-class modules (each
  // an object whose values are all obfuscated class-name strings). The plugin reads
  // this off the loader global for stable native-class discovery; without a loader
  // it falls back to fragile DOM probing. Mirrors the loader's own filter.
  function buildClassMap() {
    var out = [];
    try {
      var it = Steam.modules.values(), n;
      while (!(n = it.next()).done) {
        var m = n.value;
        if (!m || typeof m !== "object" || m.__esModule) continue;
        var keys = Object.keys(m);
        if (keys.length === 0 || keys.length >= 1000) continue;
        if (keys.length === 1 && m.version) continue; // a version-only module
        if (m.AboutSettings) continue; // the localization module
        var allStrings = true;
        for (var i = 0; i < keys.length; i++) {
          var d = Object.getOwnPropertyDescriptor(m, keys[i]);
          if ((d && d.get) || typeof m[keys[i]] !== "string") { allStrings = false; break; }
        }
        if (allStrings) out.push(m);
      }
    } catch (e) {}
    return out;
  }

  // A class module discovered by a set of required string keys (the loader exposes
  // several such maps: gamepadDialog, gamepadContextMenu, quickAccessMenu, …).
  function findClassModule(requiredKeys) {
    return Steam.findModule(function (m) {
      if (!m || typeof m !== "object") return false;
      for (var i = 0; i < requiredKeys.length; i++) {
        if (typeof m[requiredKeys[i]] !== "string") return false;
      }
      return true;
    });
  }

  // React's internal hook dispatcher — needed to stub hooks for fakeRenderComponent
  // (renders a function component off-tree to read its output, so the plugin's menu
  // discovery can locate the class/type to patch). Handles the React 18 secret-
  // internals shape and the React 19 one.
  function internalHooks() {
    try {
      var d = React && React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
      if (d && d.ReactCurrentDispatcher && d.ReactCurrentDispatcher.current) return d.ReactCurrentDispatcher.current;
    } catch (e) {}
    try {
      var ci = React && React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      if (ci) { for (var k in ci) { var p = ci[k]; if (p && p.useEffect) return p; } }
    } catch (e) {}
    return null;
  }
  var _savedHooks = null;
  function applyHookStubs(customHooks) {
    var h = internalHooks();
    if (!h) return null;
    _savedHooks = {
      useContext: h.useContext, useCallback: h.useCallback, useLayoutEffect: h.useLayoutEffect,
      useEffect: h.useEffect, useMemo: h.useMemo, useRef: h.useRef, useState: h.useState,
    };
    h.useCallback = function (cb) { return cb; };
    h.useContext = function (cb) { return cb && cb._currentValue; };
    h.useLayoutEffect = function () {};
    h.useMemo = function (cb) { return cb; };
    h.useEffect = function () {};
    h.useRef = function (val) { return { current: val || {} }; };
    h.useState = function (v) { var val = v; return [val, function (n) { val = n; }]; };
    if (customHooks) { for (var ck in customHooks) h[ck] = customHooks[ck]; }
    return h;
  }
  function removeHookStubs() {
    var h = internalHooks();
    if (h && _savedHooks) { for (var k in _savedHooks) h[k] = _savedHooks[k]; }
    _savedHooks = null;
  }
  // Restore the dispatcher even if the component throws mid-render — a leaked
  // stub would corrupt the NEXT real render (this runs from an event handler, so
  // no React render is interleaved, but the finally keeps a throw from leaking).
  function fakeRenderComponent(fun, customHooks) {
    var h = applyHookStubs(customHooks);
    try { return fun(h); }
    catch (e) { return null; }
    finally { removeHookStubs(); }
  }
  // Loader-style findModuleChild: first truthy result of `filter` over each
  // module (and its `.default`).
  function findModuleChild(filter) {
    var it = Steam.modules.values(), n;
    while (!(n = it.next()).done) {
      var m = n.value, variants = [m && m.default, m];
      for (var i = 0; i < variants.length; i++) {
        try { var r = filter(variants[i]); if (r) return r; } catch (e) {}
      }
    }
    return undefined;
  }

  // Sole host: the plugin resolves its frontend-library helpers per host (it falls
  // back to `__SHELVES_HOST__.ui` when no loader is present — the plugin's neutral
  // path). Our `host.ui` already carries the discovered Steam components; augment it
  // IN PLACE with the extra helpers the plugin's menu/class code needs (webpack
  // finders, react-tree/patch utilities, the GamepadButton enum, menu sub-components,
  // and the native class maps). We do NOT publish any loader-named global (`window.DFL`)
  // — the host stays neutral; the plugin reads these off the host adapter instead.
  //
  // The plugin's UI shim reads MenuGroup + the native class maps at bundle-boot, so
  // they must be resolved BEFORE the bundle is released (signalUiReady). But those
  // module scans are heavy — running them all synchronously blocks the main thread
  // long enough to starve STEAM's own home render (observed: whole home comes up
  // empty). So run them CHUNKED (one per timer tick, yielding between — like the UI
  // scan), and only call `onDone` (signalUiReady) once they finish.
  function augmentHostUi(onDone) {
    if (UI.__loaderAugmented || !React) { if (onDone) onDone(); return; }
    UI.__loaderAugmented = true;
    // Cheap assignments (references + literals — no scans): safe to do now. These
    // are all references the plugin calls ON DEMAND (menu open, native-recents
    // render) — never invoked here at boot — so publishing them is free. The
    // tree-patcher (afterPatch) preserves the original's React shape (memo /
    // forwardRef / function), which the native recents replace requires — it
    // patches `element.type` slots that are `memo` OBJECTS on this Steam, and a
    // naive function wrapper threw at render and unmounted the whole route.
    try {
      UI.staticClasses = {};
      UI.afterPatch = afterPatch;
      UI.findInTree = findInTree;
      UI.findInReactTree = findInReactTree;
      UI.findModuleByExport = Steam.findModuleByExport;
      UI.findModuleChild = findModuleChild;
      UI.fakeRenderComponent = fakeRenderComponent;
      UI.GamepadButton = {
        INVALID: 0, OK: 1, CANCEL: 2, SECONDARY: 3, OPTIONS: 4, BUMPER_LEFT: 5, BUMPER_RIGHT: 6,
        TRIGGER_LEFT: 7, TRIGGER_RIGHT: 8, DIR_UP: 9, DIR_DOWN: 10, DIR_LEFT: 11, DIR_RIGHT: 12,
        SELECT: 13, START: 14, LSTICK_CLICK: 15, RSTICK_CLICK: 16, LSTICK_TOUCH: 17, RSTICK_TOUCH: 18,
        LPAD_TOUCH: 19, LPAD_CLICK: 20, RPAD_TOUCH: 21, RPAD_CLICK: 22, REAR_LEFT_UPPER: 23,
        REAR_LEFT_LOWER: 24, REAR_RIGHT_UPPER: 25, REAR_RIGHT_LOWER: 26, STEAM_GUIDE: 27, STEAM_QUICK_MENU: 28,
      };
    } catch (e) {}
    // Heavy module scans — one per tick.
    var tasks = [
      function () {
        UI.MenuSeparator = Steam.findModuleExport(function (e) {
          return typeof e === "function" && /className:.+?\.ContextMenuSeparator/.test(srcOf(e));
        });
      },
      function () {
        var groupMod = Steam.findModuleByExport(function (e) {
          try {
            return !!(e && e.prototype && e.prototype.Focus && e.prototype.OnOKButton &&
              e.prototype.render && srcOf(e.prototype.render).indexOf('"emphasis"==this.props.tone') >= 0);
          } catch (x) { return false; }
        });
        UI.MenuGroup = groupMod && Object.values(groupMod).find(function (e) {
          return typeof e === "function" && srcOf(e).indexOf("bInGamepadUI:") >= 0;
        });
      },
      function () { UI.gamepadDialogClasses = findClassModule(["Field", "GamepadDialogContent", "StandardPadding"]); },
      function () { UI.gamepadContextMenuClasses = findClassModule(["ContextMenuSeparator", "contextMenuItem"]) || findClassModule(["contextMenuItem"]); },
      function () { UI.quickAccessMenuClasses = findClassModule(["QuickAccessMenu", "Tab"]) || findClassModule(["Tab", "TabBadge"]); },
      function () { UI.quickAccessControlsClasses = findClassModule(["ScrollPanel", "PanelSection"]) || findClassModule(["PanelSection", "PanelSectionTitle"]); },
      function () { UI.scrollPanelClasses = findClassModule(["ScrollPanel", "ScrollY"]); },
      function () { UI.classMap = buildClassMap(); },
    ];
    var i = 0;
    (function next() {
      if (i >= tasks.length) {
        log("host.ui augmented with loader-equivalent helpers (neutral, no global).");
        if (onDone) onDone();
        return;
      }
      try { tasks[i](); } catch (e) {}
      i++;
      setTimeout(next, 60);
    })();
  }

  // The root node of Steam's main home gamepad-nav tree (GamepadUI_Full_Root), or
  // null. Shared by the hidden-node prune and the unhandled-button bridge below.
  function mainNavRoot() {
    var ctrl = window.FocusNavController;
    if (!ctrl) return null;
    var ctx = ctrl.m_ActiveContext || ctrl.m_LastActiveContext;
    if (!ctx || !ctx.m_rgGamepadNavigationTrees) return null;
    var trees = ctx.m_rgGamepadNavigationTrees;
    var arr = Array.isArray(trees) ? trees : (trees.values ? Array.from(trees.values()) : []);
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].m_ID === "GamepadUI_Full_Root") return arr[i].Root || arr[i].m_Root || null;
    }
    return null;
  }

  // Sole host: hidden native home sections (recents "Jogo atual", news/friends
  // "Novidades") stay 0x0 but remain FOCUSABLE gamepad nav nodes, so DOWN from the
  // search bar stops on each invisible node before reaching our shelves (extra dpad
  // presses). Under a loader they never linger as nav nodes; here they do. Remove 0x0
  // nodes that are NOT ours from the home nav tree — but REVERSIBLY: each removed node
  // is recorded, and the moment its element becomes visible again (the plugin
  // re-enabled that section) it is put straight back, so re-enabling recents / the
  // home tabs still works. The 0x0 test only ever removes ALREADY-hidden nodes, so it
  // obeys whatever the plugin shows or hides — the plugin needs no changes. Steam
  // rebuilds the tree on real remounts (not on a CSS-only show/hide, which is exactly
  // why the restore step is needed), so this re-runs on a modest interval.
  var _prunedNodes = [];
  function pruneHiddenNavNodes() {
    try {
      var root = mainNavRoot();
      if (!root) return;
      var zeroSize = function (el) {
        if (!el || !el.getBoundingClientRect) return false;
        var r = el.getBoundingClientRect();
        return r.width === 0 && r.height === 0;
      };
      var ours = function (el) {
        try {
          var m = el.ownerDocument && el.ownerDocument.getElementById("deck-shelves-home-root");
          return !!(m && m.contains(el));
        } catch (e) { return false; }
      };
      var touched = false;
      // Restore pass: any node we removed whose element is now VISIBLE again goes
      // back into its parent (nav order is fixed by clearing m_bChildrenSorted, so
      // Steam re-sorts by DOM position). Drop records whose element has detached.
      for (var k = _prunedNodes.length - 1; k >= 0; k--) {
        var rec = _prunedNodes[k];
        var el = rec.node && rec.node.m_element;
        var attached = !!(el && el.ownerDocument && el.ownerDocument.contains(el));
        if (!attached) { _prunedNodes.splice(k, 1); continue; }
        if (!zeroSize(el)) {
          try {
            if (rec.parent && rec.parent.m_rgChildren && rec.parent.m_rgChildren.indexOf(rec.node) < 0) {
              rec.parent.m_rgChildren.push(rec.node);
              rec.parent.m_bChildrenSorted = false;
              touched = true;
            }
          } catch (e) {}
          _prunedNodes.splice(k, 1);
        }
      }
      // Prune pass: remove currently-hidden 0x0 native nodes, recording each so the
      // restore pass can put it back when the plugin shows that section again.
      (function walk(node, depth) {
        if (!node || !node.m_rgChildren || depth > 6) return;
        var kids = node.m_rgChildren;
        for (var j = kids.length - 1; j >= 0; j--) {
          var c = kids[j];
          if (c && c.m_element && zeroSize(c.m_element) && !ours(c.m_element)) {
            kids.splice(j, 1);
            _prunedNodes.push({ node: c, parent: node });
            touched = true;
          } else {
            walk(c, depth + 1);
          }
        }
      })(root, 0);
      if (touched) { try { root.m_bChildrenSorted = false; } catch (e) {} }
    } catch (e) {}
  }
  var _navPruneTimer = null;
  function startNavPrune() {
    if (_navPruneTimer) return;
    _navPruneTimer = setInterval(pruneHiddenNavNodes, 500);
  }

  // (A) Host API — installed only when we are NOT coexisting with another
  // loader. In coexistence we leave `__SHELVES_HOST__` unset so the other
  // loader's Deck Shelves keeps selecting its own adapter (safety invariant).
  // (B) — the QAM tab — already ran above via QamHost, regardless of coexistence.
  if (!COEXIST) {
    window.__SHELVES_HOST__ = host;
    try { window.__DECK_SHELVES_OWNER__ = "shelveshub"; } catch (e) {}
    startNavPrune();
    // NOTE: host.ui is augmented with loader-equivalent helpers from the UI-scan's
    // onDone (before signalUiReady), so it's complete when the bundle's shim binds
    // to `__SHELVES_HOST__.ui` — see the ensureUiChunked call near the UI section.
  } else {
    try { if (!window.__DECK_SHELVES_OWNER__) window.__DECK_SHELVES_OWNER__ = "decky"; } catch (e) {}
  }
  log("runtime ready v" + HOST_API_VERSION + (Steam.isSteam() ? " (Steam)" : " (no webpack)") +
    " ui[" + Object.keys(UI).filter(function (k) { return !!UI[k]; }).join(",") + "]" +
    " qam=" + QamHost.mode() + (COEXIST ? " coexist(tab-only)" : " owner"));
  return COEXIST ? undefined : HOST_API_VERSION;
})();
