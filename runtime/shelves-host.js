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
    var t0 = Date.now();
    // A plain timer, NOT requestIdleCallback: Steam's renderer is never idle, so
    // the idle callback never fires. The gap between ticks lets the renderer breathe
    // so a single short step (~25ms, measured safe) never stalls the main thread.
    // In sole mode the bundle boot is GATED behind this scan (nothing else is
    // running to starve), so a small gap is enough and keeps cold-start snappy.
    (function next() {
      if (i >= uiSteps.length) {
        log("UI scan complete in " + (Date.now() - t0) + "ms (" + uiSteps.length + " steps).");
        if (onDone) onDone();
        return;
      }
      runUiStep(i++);
      setTimeout(next, 30);
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
        if (!this.state.err) return this.props.children;
        // A `fallback` element (the hub view) takes over when the wrapped panel
        // throws — so a failed Deck Shelves render lands on the host's own hub
        // screen (download / update / logs), not a bare error line.
        if (this.props.fallback) return this.props.fallback;
        return h("div", { style: { padding: "16px", color: "#ff8d8d", fontSize: "13px" } },
          I18N.t("panel_error"));
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
      // On a render error, fall back to the host's hub view rather than a bare
      // error line — the plugin failing to load should still leave the user with
      // the host's own actions.
      return ErrorBoundary ? h(ErrorBoundary, { fallback: h(FallbackPanel, null) }, inner) : inner;
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
    // Plugin-style collapsible section (chevron header + persisted open state +
    // separator + content), mirroring the plugin's CollapsibleSection so the hub's
    // Advanced area reads the same. Its own component so each section keeps state.
    var HUB_SECTIONS_KEY = "ds-hub-sections";
    function readHubSections() { try { return JSON.parse(localStorage.getItem(HUB_SECTIONS_KEY) || "{}"); } catch (e) { return {}; } }
    function HubCollapsible(props) {
      var id = props.id, title = props.title;
      var s0 = readHubSections();
      var initial = (id in s0) ? !!s0[id] : props.initialOpen === true;
      var st = React.useState(initial);
      var open = st[0], setOpen = st[1];
      var toggle = function () {
        setOpen(function (o) {
          var n = !o;
          try { var s = readHubSections(); s[id] = n; localStorage.setItem(HUB_SECTIONS_KEY, JSON.stringify(s)); } catch (e) {}
          return n;
        });
      };
      // Flat QAM look (like the plugin): uppercase dim header, whole-row focus
      // highlight (background, not a ring), thin separator, no surrounding box.
      // When collapsed, a count badge (like the plugin's) hints at the contents.
      var chevron = h("span", { key: "c", style: { fontSize: "9px", opacity: 0.7, flex: "0 0 auto" } }, open ? "▲" : "▼");
      var titleEl = h("span", { key: "t", style: { flex: "1 1 auto", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, title);
      var right = [];
      if (!open && typeof props.count === "number" && props.count > 0) {
        right.push(h("span", { key: "b", style: { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "18px", height: "18px", padding: "0 6px", borderRadius: "9px", background: "rgba(255,255,255,0.14)", fontSize: "10px", fontWeight: "700" } }, String(props.count)));
      }
      right.push(chevron);
      var rightEl = h("span", { key: "r", style: { display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto" } }, right);
      var hStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: "40px", boxSizing: "border-box", width: "100%", padding: "8px 16px", cursor: "pointer", fontWeight: "600", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px", color: "rgba(255,255,255,0.72)" };
      var header = focusableComp
        ? h(focusableComp, { key: "h", "data-fb": "sec-" + id, onActivate: toggle, onOKButton: toggle, focusClassName: "shelves-rowfocus", style: hStyle }, titleEl, rightEl)
        : h("div", { key: "h", "data-fb": "sec-" + id, onClick: toggle, style: hStyle }, titleEl, rightEl);
      var kids = [header];
      if (open) {
        kids.push(h("div", { key: "sep", style: { height: "1px", background: "rgba(255,255,255,0.09)" } }));
        kids.push(h("div", { key: "ct", style: { padding: "2px 0 10px" } }, props.children));
      }
      return h("div", { className: "ds-hub-collapsible", style: { marginTop: "6px" } }, kids);
    }
    // Version footer, pinned at the end of the panel (like the plugin's).
    function hubVersionFooter(version) {
      return h("div", { key: "verfoot", "data-fb": "version", style: { textAlign: "center", padding: "10px 12px 6px", fontSize: "11px", lineHeight: "15px", color: "rgba(255,255,255,0.4)" } },
        "ShelvesHub" + (version ? " · v" + version : ""));
    }
    function FallbackPanel(props) {
      var onBack = props && props.onBack;
      var st = React.useState(null);
      var busy = st[0], setBusy = st[1];
      // null = still loading; then the full update-preference object mirrors the
      // store: the master switch, the per-target switches, and their beta
      // channels. Per-target switches default ON (see HubSettings::default).
      var DEFAULT_UPD = { auto_update: false, auto_update_hub: true, hub_prerelease: false, auto_update_plugin: true, plugin_prerelease: false };
      var au = React.useState(null);
      var cfg = au[0], setCfg = au[1];
      // null = hub view; an array = the log viewer showing merged daemon+runtime lines.
      var lg = React.useState(null);
      var logs = lg[0], setLogs = lg[1];
      // Advanced section: `rc` holds the runtime-config mirror (getRuntimeConfig),
      // fetched once on mount; `rcDirty` flags an edit this session so a "restart
      // to apply" note shows. The collapsible open state lives in HubCollapsible.
      var rcS = React.useState(null);
      var rc = rcS[0], setRc = rcS[1];
      var rd = React.useState(false);
      var rcDirty = rd[0], setRcDirty = rd[1];
      React.useEffect(function () {
        var alive = true;
        hostRpc("getRuntimeConfig").then(function (r) {
          if (alive && r && r.ok && r.result && typeof r.result === "object") setRc(r.result);
        }, function () {});
        return function () { alive = false; };
      }, []);
      function mergeRc(patch) { var n = {}; if (rc) for (var k in rc) n[k] = rc[k]; for (var p in patch) n[p] = patch[p]; setRc(n); }
      function applyPaused(v) { mergeRc({ paused: v }); hostRpc("setHostingPaused", v).then(function () {}, function () {}); }
      function applyCfg(key, val) { mergeRc((function () { var o = {}; o[key] = val; return o; })()); setRcDirty(true); hostRpc("setRuntimeConfig", { key: key, value: val }).then(function () {}, function () {}); }
      function viewLogs() {
        setBusy("logs");
        hostRpc("getLogs", 200).then(function (r) {
          setBusy(null);
          setLogs(r && r.ok && Array.isArray(r.result) ? r.result : []);
        }, function () { setBusy(null); setLogs([]); });
      }
      // Clear the viewer's log ring on the daemon, then refresh the (now-empty) list.
      function clearLogs() {
        setBusy("logs");
        hostRpc("clearLogs").then(function () { setBusy(null); setLogs([]); }, function () { setBusy(null); });
      }
      React.useEffect(function () {
        var alive = true;
        hostRpc("getConfig").then(function (r) {
          if (!alive) return;
          setCfg(r && r.ok && r.result && typeof r.result === "object" ? r.result : DEFAULT_UPD);
        }, function () { if (alive) setCfg(DEFAULT_UPD); });
        return function () { alive = false; };
      }, []);
      // Effective config for this render (defaults while still loading).
      var uc = cfg || DEFAULT_UPD;
      var on = uc.auto_update === true;
      // Coexisting with another loader (it owns the renderer): the hub does NOT
      // host or update the plugin here — the loader does. So the update actions
      // (download / self-install) and auto-update toggles are hidden and a note
      // points at the loader. Detected from the owner global (sole = "shelveshub").
      var coexist = (function () { try { var o = window.__DECK_SHELVES_OWNER__; return !!(o && o !== "shelveshub"); } catch (e) { return false; } })();
      // B (CANCEL) handling: a plain onCancel/onCancelButton is NOT enough — the
      // QAM router still navigates the tab away. We must ABSORB the button-down
      // (preventDefault + stopImmediatePropagation on the event AND its inner
      // event), then run our own back action. Mirrors the plugin's sidecar cancel.
      function makeBackButtonDown(back) {
        return function (evt) {
          try {
            var d = evt && evt.detail;
            if (!d || d.button !== 2) return false; // 2 = CANCEL (B)
            try { evt.preventDefault(); evt.stopImmediatePropagation(); } catch (e) {}
            try { var inner = d.event; if (inner) { inner.preventDefault(); inner.stopImmediatePropagation(); } } catch (e) {}
            back();
            return true;
          } catch (e) { return false; }
        };
      }
      var backToHub = function () { setLogs(null); };
      // B follows the CURRENT context, not always "back to Deck Shelves":
      // inside the expanded log panel B collapses it back to the hub screen;
      // otherwise (opened from the editor) B returns to Deck Shelves. When
      // neither applies (standalone hub, logs closed) B falls through to close
      // the tab as usual.
      var contextualBack = (logs !== null) ? backToHub : (onBack || null);
      // Root wrapper for the hub view: when there is a contextual back action,
      // wrap in a Focusable that absorbs B and runs it instead of letting the
      // QAM router navigate the tab away.
      function panelRoot(baseProps, kids) {
        var useFocus = !!(contextualBack && focusableComp);
        var props = {};
        for (var k in baseProps) props[k] = baseProps[k];
        if (useFocus) {
          props.onButtonDown = makeBackButtonDown(contextualBack);
          props.onCancel = function () { try { contextualBack(); } catch (e) {} };
        }
        return React.createElement.apply(React, [useFocus ? focusableComp : "div", props].concat(kids));
      }
      // "Restart to update" notice: shown when the daemon has detected a newer
      // ShelvesHub release it can't self-replace in place yet (getConfig reports
      // `pending_hub_update`). Informational — the user restarts the service to apply.
      function hubUpdateNotice() {
        var ver = uc.pending_hub_update;
        if (typeof ver !== "string" || !ver) return null;
        // Once the update has been downloaded and staged over the binary, the
        // wording shifts from "restart to update" to "downloaded — restart to
        // finish" (a relaunching service applies it on its own, so this only ever
        // shows for a manually-run daemon).
        var label = uc.hub_update_staged === true ? "hub_update_staged" : "hub_update_restart";
        return h("div", { key: "hubupd", "data-fb": "hub-update", style: { display: "flex", alignItems: "center", gap: "8px", background: "rgba(26,159,255,0.15)", border: "1px solid rgba(26,159,255,0.45)", borderRadius: "6px", padding: "8px 10px", margin: "0 0 10px", fontSize: "13px" } },
          fbIcon("update"), h("span", { key: "t" }, I18N.t(label) + " (" + ver + ")"));
      }
      // The "Advanced" area: a plugin-style collapsible whose content is grouped
      // into collapsible sub-sections (Troubleshooting / Configuration / Status),
      // with localized labels, centered steppers, and focusable rows.
      var advRowStyle = { display: "flex", alignItems: "center", gap: "10px", minHeight: "40px", width: "100%", boxSizing: "border-box", padding: "6px 16px", border: "none", background: "transparent", color: "#fff", cursor: "pointer", fontSize: "13px" };
      var advToggleRow = function (key, label, checked, onAct) {
        return clickable(function () { onAct(!checked); }, { key: key, "data-fb": key, "data-on": checked ? "1" : "0", focusClassName: "shelves-rowfocus", style: advRowStyle },
          [h("span", { key: "t", style: { flex: "1 1 auto", textAlign: "left" } }, label), updSwitch(checked)]);
      };
      var advStepRow = function (key, label, val) {
        var stepBtn = function (sym, delta) {
          return clickable(function () { applyCfg(key, Math.max(0, (Number(val) || 0) + delta)); }, { key: key + sym, "data-fb": key + sym, style: { flex: "0 0 auto", width: "30px", height: "28px", borderRadius: "4px", border: "none", background: "rgba(255,255,255,0.14)", color: "#fff", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "16px", lineHeight: "1", padding: "0" } }, [sym]);
        };
        return h("div", { key: key, style: { display: "flex", alignItems: "center", gap: "8px", minHeight: "40px", boxSizing: "border-box", padding: "6px 16px", fontSize: "13px" } },
          h("span", { key: "l", style: { flex: "1 1 auto" } }, label), stepBtn("−", -5), h("span", { key: "v", style: { flex: "0 0 auto", minWidth: "34px", textAlign: "center", fontFamily: "monospace" } }, String(Number(val) || 0)), stepBtn("+", 5));
      };
      // Read-only status rows: focusable (so the gamepad can walk them), whole-row
      // highlight, label left + value right for a clean two-column read.
      var advRoRow = function (key, label, val) {
        var body = [
          h("span", { key: "l", style: { flex: "0 0 auto", color: "rgba(255,255,255,0.72)" } }, label),
          h("span", { key: "v", style: { flex: "1 1 auto", textAlign: "right", fontFamily: "monospace", wordBreak: "break-all", color: "rgba(255,255,255,0.92)" } }, String(val)),
        ];
        var st = { display: "flex", alignItems: "center", gap: "10px", minHeight: "36px", boxSizing: "border-box", padding: "6px 16px", fontSize: "12px" };
        return focusableComp
          ? h(focusableComp, { key: key, "data-fb": "ro-" + key, onActivate: function () {}, focusClassName: "shelves-rowfocus", style: st }, body)
          : h("div", { key: key, style: st }, body);
      };
      // A flat, edge-to-edge action row (icon + label), same pattern as the other
      // rows so buttons and toggles read as one unified list.
      function actionRow(id, iconKey, labelKey, method) {
        return clickable(function () { if (!busy) run(id, method); }, { key: "act-" + id, "data-fb": id, focusClassName: "shelves-rowfocus", style: { display: "flex", alignItems: "center", gap: "10px", minHeight: "40px", width: "100%", boxSizing: "border-box", padding: "6px 16px", border: "none", background: "transparent", color: "#fff", cursor: "pointer", fontSize: "13px", opacity: (busy && busy !== id) ? 0.5 : 1 } },
          [fbIcon(iconKey), h("span", { key: "t", style: { flex: "1 1 auto", textAlign: "left" } }, I18N.t(labelKey))]);
      }
      // The whole panel body as top-level collapsible sections (no "Advanced"
      // wrapper) in the plugin's flat QAM style: Updates, Troubleshooting,
      // Configuration, Status. Each carries a count badge when collapsed.
      function buildSections(useNative, TF) {
        var sections = [];
        // Updates: in coexist the loader owns the plugin — show a note, no
        // hub-hosting toggles/actions (they'd fetch+swap a bundle the loader owns).
        var upd, updCount;
        if (coexist) {
          upd = [h("div", { key: "cx", "data-fb": "updates-note", style: { padding: "8px 16px", fontSize: "12px", color: "rgba(255,255,255,0.6)" } }, I18N.t("updates_managed_elsewhere"))];
          updCount = 0;
        } else {
          upd = updRows(useNative, TF).slice();
          upd.push(actionRow("download", "download", "action_download", "populateBundle"));
          upd.push(actionRow("update", "update", "action_update_hub", "selfUpdate"));
          updCount = upd.length;
        }
        sections.push(h(HubCollapsible, { key: "sec-upd", id: "sec-updates", title: I18N.t("sec_updates"), count: updCount, initialOpen: true }, upd));
        var trouble = [actionRow("logs", "logs", "action_logs", "getLogs")];
        if (rc) {
          trouble.push(advToggleRow("adv-pause", I18N.t("adv_disable_hub"), rc.paused === true, applyPaused));
          if (rc.paused === true) trouble.push(h("div", { key: "pn", style: { padding: "2px 16px 6px", fontSize: "12px", color: "#ffcf6b" } }, I18N.t("adv_paused")));
        }
        sections.push(h(HubCollapsible, { key: "sec-tr", id: "sec-troubleshooting", title: I18N.t("adv_sec_troubleshooting"), count: rc ? 2 : 1 }, trouble));
        if (rc) {
          // Only genuine operational config here — `native_qam` (default on; a
          // recovery knob left to the config file/env) and `prerelease` (already
          // covered by the Updates section's pre-release channels) are intentionally
          // NOT surfaced. The coexist-only settings (force_owner, owner_settle_secs)
          // are shown only where another loader can exist (Linux/SteamOS) — on a
          // pure sole host (macOS/Windows) they are inert, so they are hidden too.
          var conf = [];
          if (rc.loader_possible) {
            conf.push(advToggleRow("cfg-force_owner", I18N.t("cfg_force_owner"), rc.force_owner === true, function (v) { applyCfg("force_owner", v); }));
            conf.push(advStepRow("owner_settle_secs", I18N.t("cfg_owner_settle"), rc.owner_settle_secs));
          }
          conf.push(advStepRow("interval_secs", I18N.t("cfg_interval"), rc.interval_secs));
          var confCount = conf.length;
          if (rcDirty) conf.push(h("div", { key: "rn", style: { padding: "6px 16px 2px", fontSize: "12px", color: "#ffcf6b" } }, I18N.t("adv_restart_note")));
          sections.push(h(HubCollapsible, { key: "sec-cf", id: "sec-config", title: I18N.t("adv_sec_config"), count: confCount }, conf));
          var status = [
            advRoRow("cef", I18N.t("cfg_cef"), (rc.cef_host || "") + ":" + (rc.cef_port || "")),
            advRoRow("rpc", I18N.t("cfg_rpc"), rc.rpc_addr || ""),
            advRoRow("recover", I18N.t("cfg_recover_cmd"), rc.recover_cmd == null ? "—" : rc.recover_cmd),
            advRoRow("bundle", I18N.t("cfg_bundle"), rc.bundle_path || ""),
            advRoRow("backend", I18N.t("cfg_backend"), rc.backend ? "on" : "off"),
            advRoRow("version", I18N.t("cfg_version"), rc.version || ""),
          ];
          sections.push(h(HubCollapsible, { key: "sec-st", id: "sec-status", title: I18N.t("adv_sec_status"), count: status.length }, status));
        }
        return sections;
      }
      function run(id, method) {
        if (method === "getLogs") { viewLogs(); return; }
        setBusy(id);
        hostRpc(method).then(function () { setBusy(null); }, function () { setBusy(null); });
      }
      // Persist one update preference. The master goes through setAutoUpdate
      // (kept for back-compat); the nested switches through setUpdatePref. The
      // UI updates optimistically and reconciles with the store's echo.
      function applyPref(key, next) {
        if (busy) return;
        var optimistic = {}; for (var k in uc) optimistic[k] = uc[k]; optimistic[key] = next;
        setCfg(optimistic); setBusy("upd");
        var method = key === "auto_update" ? "setAutoUpdate" : "setUpdatePref";
        var args = key === "auto_update" ? next : { key: key, value: next };
        hostRpc(method, args).then(function (r) {
          setBusy(null);
          if (r && r.ok && r.result && typeof r.result === "object") setCfg(r.result);
        }, function () { setBusy(null); setCfg(uc); });
      }
      // The nested update hierarchy: master → { hub, plugin } → each a beta
      // channel. A child is HIDDEN (not disabled) while any ancestor switch is
      // off — the moment the parent turns on the child appears. `visible` encodes
      // the full ancestor chain, so filtering by it hides whole sub-trees at once.
      var UPD_ROWS = [
        { key: "auto_update",        labelKey: "action_auto_update", depth: 0, visible: function () { return true; } },
        { key: "auto_update_hub",    labelKey: "update_hub",         depth: 1, visible: function () { return on; } },
        { key: "hub_prerelease",     labelKey: "update_beta",        depth: 2, visible: function () { return on && uc.auto_update_hub === true; } },
        { key: "auto_update_plugin", labelKey: "update_plugin",      depth: 1, visible: function () { return on; } },
        { key: "plugin_prerelease",  labelKey: "update_beta",        depth: 2, visible: function () { return on && uc.auto_update_plugin === true; } },
      ];
      function updSwitch(checked) {
        return h("span", { key: "sw", style: { flex: "0 0 auto", width: "38px", height: "22px", borderRadius: "11px", position: "relative", background: checked ? "#1a9fff" : "rgba(255,255,255,0.25)" } },
          h("span", { style: { position: "absolute", top: "2px", left: checked ? "18px" : "2px", width: "18px", height: "18px", borderRadius: "50%", background: "#fff" } }));
      }
      // useNative renders each level as a native ToggleField; the plain path uses
      // a self-contained focusable row with a hand-drawn switch. Indentation (per
      // depth) conveys the hierarchy; rows whose ancestor is off are not rendered.
      function updRows(useNative, TF) {
        return UPD_ROWS.filter(function (rw) { return rw.visible(); }).map(function (rw) {
          var checked = uc[rw.key] === true;
          var indent = rw.depth * 20;
          if (useNative && TF) {
            return h("div", { key: rw.key, style: { marginLeft: indent + "px", marginTop: rw.depth ? "2px" : "10px" } },
              h(TF, { label: I18N.t(rw.labelKey), checked: checked, disabled: !!busy, onChange: function (v) { applyPref(rw.key, !!v); } }));
          }
          var rowStyle = { display: "flex", alignItems: "center", gap: "10px", width: "100%", boxSizing: "border-box", padding: "10px 14px", marginTop: rw.depth ? "4px" : "8px", marginLeft: indent + "px", textAlign: "left", border: "none", borderRadius: "4px", fontSize: "14px", color: "#fff", background: "rgba(255,255,255,0.08)", cursor: busy ? "default" : "pointer" };
          return clickable(function () { if (!busy) applyPref(rw.key, !checked); }, { key: rw.key, "data-fb": "upd-" + rw.key, "data-on": checked ? "1" : "0", style: rowStyle },
            [h("span", { key: "t", style: { flex: "1 1 auto" } }, I18N.t(rw.labelKey)), updSwitch(checked)]);
        });
      }

      // ── Log viewer ── merged daemon + runtime lines (getLogs), each parsed
      // from `[LEVEL] [ts] [scope] msg` into a badged row (level colour + scope),
      // so it reads like the plugin's Advanced → Logs. Newest first, scrollable.
      // Rendered inline below the hub actions (an expandable panel that keeps the
      // ShelvesHub screen visible); the gamepad reaches it in the normal nav flow.
      function buildLogView() {
        var parseLine = function (line) {
          var m = /^\[(\w+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+([\s\S]*)$/.exec(String(line));
          return m ? { level: m[1].toUpperCase(), ts: m[2], scope: m[3], msg: m[4] }
                   : { level: "INFO", ts: "", scope: "", msg: String(line) };
        };
        // Each row is a Focusable item (gamepad-navigable, like the plugin's
        // Advanced → Logs list), falling back to a plain <div> before Focusable
        // is discovered. Steam moves focus row-to-row and scrolls the container.
        var logRow = function (line, i) {
          var p = parseLine(line);
          var lb = LOG_LEVEL_BG[p.level] || "#64748b";
          var sc = LOG_SCOPE_COLOR[p.scope] || "rgba(255,255,255,0.14)";
          var rowStyle = { display: "flex", gap: "8px", alignItems: "baseline", padding: "7px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: "12px", lineHeight: "1.5", fontFamily: "monospace" };
          var kids = [
            h("span", { key: "lv", style: { flex: "0 0 auto", background: lb, color: "#04121f", padding: "0 4px", borderRadius: "2px", fontWeight: "800" } }, p.level),
            p.scope ? h("span", { key: "sc", style: { flex: "0 0 auto", background: sc, color: "#04121f", padding: "0 4px", borderRadius: "2px", fontWeight: "700" } }, p.scope) : null,
            h("span", { key: "ms", style: { flex: "1 1 auto", color: "rgba(255,255,255,0.88)", wordBreak: "break-word", whiteSpace: "pre-wrap" } }, p.msg),
            p.ts ? h("span", { key: "ts", style: { flex: "0 0 auto", color: "rgba(255,255,255,0.4)" } }, p.ts.slice(11)) : null,
          ];
          // A Focusable only becomes a gamepad focus STOP when it has an activate
          // handler — the plugin's log rows carry one too. Without it Steam skips
          // the row and focus never lands in the list (the "can't focus" bug). The
          // handler is a no-op; the row is a read-only line.
          var props = focusableComp
            ? { key: "l" + i, focusClassName: "shelves-rowfocus", style: rowStyle, "data-fb": "log-row", onActivate: function () {}, onOKButton: function () {} }
            : { key: "l" + i, style: rowStyle, "data-fb": "log-row" };
          return React.createElement.apply(React, [focusableComp || "div", props].concat(kids));
        };
        var rows = logs.length
          ? logs.slice().reverse().map(logRow)
          : [h("div", { key: "empty", style: { opacity: 0.6, fontSize: "13px", padding: "8px 0" } }, I18N.t("logs_empty"))];
        // Header controls in a HORIZONTAL Focusable row (back / refresh / clear) so
        // the gamepad walks them left-to-right, not top-to-bottom.
        var ctrlBtn = function (key, onAct, label, extraStyle) {
          var base = { display: "inline-flex", alignItems: "center", justifyContent: "center", height: "32px", padding: "0 10px", borderRadius: "4px", background: "rgba(255,255,255,0.08)", cursor: "pointer", border: "none", color: "#fff", fontSize: "12px" };
          if (extraStyle) for (var s in extraStyle) base[s] = extraStyle[s];
          return clickable(onAct, { key: key, "data-fb": "logs-" + key, focusClassName: "shelves-gpfocus", style: base }, label);
        };
        var ctrls = [
          ctrlBtn("back", backToHub, [fbIcon("back")], { width: "36px", padding: "0" }),
          h("div", { key: "ttl", style: { fontSize: "16px", fontWeight: "700", flex: "1 1 auto" } }, I18N.t("logs_title")),
          ctrlBtn("refresh", function () { viewLogs(); }, [I18N.t("logs_refresh")]),
          ctrlBtn("clear", function () { clearLogs(); }, [I18N.t("logs_clear")]),
        ];
        var header = React.createElement.apply(React, [
          focusableComp || "div",
          focusableComp
            ? { "flow-children": "horizontal", style: { display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto", padding: "0 16px 8px" } }
            : { style: { display: "flex", alignItems: "center", gap: "8px", padding: "0 16px 8px" } },
        ].concat(ctrls));
        // Inline, expandable list kept BELOW the hub actions (which stay visible —
        // the ShelvesHub screen is preserved). A vertical Focusable so the gamepad
        // walks the rows in the normal flow (no click needed to focus) and B
        // (onButtonDown) collapses it back. Capped height with its own scroll so it
        // never grows the panel unbounded.
        var listProps = focusableComp
          ? { "flow-children": "vertical", onButtonDown: makeBackButtonDown(backToHub), onCancel: backToHub, style: { maxHeight: "300px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "1px" } }
          : { style: { maxHeight: "300px", overflowY: "auto" } };
        var list = React.createElement.apply(React, [focusableComp || "div", listProps].concat(rows));
        return h("div", { key: "logs-view", style: { marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.12)" }, "data-fb": "logs-view" },
          header,
          h("div", { key: "gap", style: { height: "8px" } }),
          list);
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
      // ── One unified panel body (no native/plain split): a shared title + notice,
      //    then the collapsible sections (native ToggleFields when available, else
      //    the plain fallback inside them), the inline log view, and the version
      //    footer. EDGE-TO-EDGE: the panel has NO horizontal padding — every row and
      //    section header owns its own 16px inset, so the focus highlight reaches the
      //    panel edges while content stays aligned (the plugin's QAM pattern). ──
      var TF = UI.ToggleField;
      var useNative = nativeUiOn() && !!TF;
      var titleRow = onBack
        ? h("div", { key: "title", style: { display: "flex", alignItems: "center", gap: "8px", padding: "4px 16px 8px" } },
            clickable(onBack, { "data-fb": "back", title: I18N.t("action_back"), focusClassName: "shelves-gpfocus", style: { flex: "0 0 auto", width: "28px", height: "28px", border: "none", borderRadius: "4px", background: "rgba(255,255,255,0.08)", color: "#fff", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" } }, [fbIcon("back")]),
            h("div", { style: { fontSize: "18px", fontWeight: "700" } }, I18N.t("hub_title")))
        : h("div", { key: "title", style: { fontSize: "18px", fontWeight: "700", padding: "6px 16px 4px" } }, I18N.t("hub_title"));
      var body = [titleRow];
      var notice = hubUpdateNotice();
      if (notice) body.push(h("div", { key: "nw", style: { padding: "0 16px" } }, notice));
      if (!onBack) body.push(h("div", { key: "sub", style: { fontSize: "13px", opacity: 0.7, padding: "0 16px 6px" } }, I18N.t("unavailable_body")));
      body = body.concat(buildSections(useNative, TF));
      if (logs !== null) body.push(buildLogView());
      body.push(hubVersionFooter(uc.version));
      return panelRoot({ style: { padding: "8px 0 0" }, "data-fb-panel": "1" }, body);
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
        "border-radius:4px;}" +
        // Whole-row focus highlight (a background, like the plugin's QAM rows) for
        // section headers and Advanced rows — not the button ring above.
        ".shelves-panel .shelves-rowfocus{background:rgba(255,255,255,.1)!important;}";
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
      // Ownership handshake: stamp the QAM-owner signal the MOMENT our tab is
      // actually in the strip — not when the `__SHELVES_QAM__` bridge global was
      // first created (that happens at boot, well before this insertion). A Deck
      // Shelves running under another loader retracts its own early tab on this
      // signal, so exactly one Deck Shelves tab survives and it is this host's —
      // and if this host never inserts (patch failed), the plugin keeps its tab
      // as the fallback instead of both vanishing. See @deck-shelves/host.
      try { window.__SHELVES_QAM_OWNER__ = "shelveshub"; } catch (e) {}
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
  //
  // NOTE: bridge presence is NOT the ownership signal — this object exists at
  // boot, before any tab is inserted. The tab-ownership handshake uses the
  // separate `window.__SHELVES_QAM_OWNER__` global, stamped only once our tab
  // actually lands in the strip (see pushTab). A coexisting Deck Shelves retracts
  // its own early tab on that, not on this bridge, so there is never a window
  // where both tabs vanish.
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
      setTimeout(next, 30);
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
