/* runtime/shelves-host.js — the ShelvesHub host runtime, injected (over CDP) into
   the Steam UI renderer before the Deck Shelves bundle, becoming window.__SHELVES_HOST__
   (the HostApi the bundle calls). Captures Steam's webpack, borrows its React + native
   gamepad UI, adds a real Quick Access tab — no third-party loader needed. The loader
   assembles this + shelves-host-qam.js + shelves-host-api.js into ONE IIFE (shared closure). */

  "use strict";

  /* Some clients (notably macOS Big Picture) open Steam's MAIN side menu over the
     home during boot via Steam's own nav-tree activation (not our code); it repeats
     then stays open. Close it during the boot window so the user lands on the home
     — bounded and self-limiting (stops once it stays closed, or after ~10s), so a
     later user-opened menu is never fought. `m_eOpenSideMenu === 1` is the MAIN menu. */
  (function () {
    try {
      const g = window;
      let closes = 0, stable = 0, tries = 0, t0 = 0;
      const iv = setInterval(function () {
        tries++;
        const inst = g.SteamUIStore && g.SteamUIStore.WindowStore && g.SteamUIStore.WindowStore.GamepadUIMainWindowInstance;
        const ms = inst && inst.m_MenuStore;
        if (!ms || typeof ms.CloseSideMenus !== "function") { if (tries > 400) clearInterval(iv); return; }
        if (!t0) t0 = Date.now();
        const st = ms.m_eOpenSideMenu;
        if (st === 1 && closes < 6) { try { ms.CloseSideMenus(); } catch (e) {} closes++; stable = 0; }
        else if (st === 0) { stable++; }
        if ((closes > 0 && stable >= 3) || closes >= 6 || Date.now() - t0 > 10000) clearInterval(iv);
      }, 250);
    } catch (e) {}
  })();

  // Derived from the daemon's `window.__SHELVES_CONFIG__` stamp (RPC address from
  // its config, contract version from @deck-shelves/host) so nothing is hardcoded
  // here; the literals are a fallback for a standalone load without the stamp.
  const SHELVES_CFG = (function () { try { return window.__SHELVES_CONFIG__ || {}; } catch (e) { return {}; } })();
  const HOST_API_VERSION = SHELVES_CFG.hostApiVersion || "1.1.0";
  const RPC_ENDPOINT = SHELVES_CFG.rpcEndpoint || "http://127.0.0.1:60123";
  // Per-boot RPC token: the daemon stamps it into __SHELVES_CONFIG__ over the CDP
  // channel only it has, and requires it on every call. Sent as a Bearer header.
  const RPC_TOKEN = SHELVES_CFG.rpcToken || "";
  function rpcHeaders() {
    const h = { "Content-Type": "application/json" };
    if (RPC_TOKEN) h.Authorization = "Bearer " + RPC_TOKEN;
    return h;
  }

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
  const LOG_SCOPE_COLOR = {
    HOST: "#22c55e", UI: "#a78bfa", ROUTER: "#ec4899", QAM: "#06b6d4",
    MENU: "#f59e0b", NAV: "#3b82f6", RPC: "#0ea5e9", UPDATE: "#14b8a6",
  };
  const LOG_LEVEL_BG = { INFO: "#0ea5e9", WARN: "#f59e0b", ERROR: "#ef4444" };
  const _logQueue = [];
  let _logFlushTimer = null;
  function _logFlushNow() {
    _logFlushTimer = null;
    if (!_logQueue.length) return;
    const set = _logQueue.splice(0, _logQueue.length);
    try {
      fetch(RPC_ENDPOINT, {
        method: "POST",
        headers: rpcHeaders(),
        body: JSON.stringify({ method: "pushLogs", args: set }),
      }).catch(function () {});
    } catch (e) {}
  }
  function _logForward(entry) {
    let verbose = false;
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
    const text = ctx === undefined ? String(msg) : String(msg) + " " + _logText([ctx]);
    try {
      const sc = LOG_SCOPE_COLOR[scope] || "#8b5cf6";
      const lb = LOG_LEVEL_BG[level] || "#0ea5e9";
      const m = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
      m.call(console, "%cShelvesHub%c" + scope + "%c " + text,
        "background:" + lb + ";color:#04121f;padding:1px 4px;font-weight:800;border-radius:2px 0 0 2px",
        "background:" + sc + ";color:#04121f;padding:1px 4px;font-weight:800;border-radius:0 2px 2px 0",
        "color:#93c5fd;font-weight:600");
    } catch (e) {}
    const entry = { t: Date.now(), level: level, scope: scope, msg: text };
    try {
      const b = (window.__SHELVES_LOG__ = window.__SHELVES_LOG__ || []);
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
  //       on via its host-selection check. When a plugin loader is already
  //       hosting Deck Shelves, installing this makes ITS bundle mis-select the
  //       ShelvesHub adapter and drop its home patches. So (A) is SKIPPED in
  //       coexistence — that is the hard safety invariant: loading ShelvesHub
  //       must never disturb that loader or its plugins.
  //   (B) add our Quick Access tab — harmless, additive (a new tab in the
  //       array; it never removes the other loader's tab). This ALWAYS runs, so
  //       ShelvesHub's tab is present with or without a loader.
  // `SHELVES_FORCE_OWNER=shelveshub` (→ `window.__SHELVES_FORCE_OWNER__`) forces
  // full ownership (installs (A) anyway), an advanced opt-in that needs the
  // loader adapter to stand down cooperatively.
  function otherLoaderPresent() {
    try {
      const w = window;
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
  let FORCE_OWNER = false;
  try { FORCE_OWNER = window.__SHELVES_FORCE_OWNER__ === "shelveshub"; } catch (e) {}
  let NATIVE_QAM_REQUESTED = false;
  try { NATIVE_QAM_REQUESTED = window.__SHELVES_NATIVE_QAM__ === true; } catch (e) {}
  const _otherLoader = otherLoaderPresent();
  /* Cooperative ownership: a loader is present AND ShelvesHub is forced. We
     publish the host (so the loader's Deck Shelves runs on it) and borrow the
     loader's UI, but NEVER scan the webpack or patch the home — the loader keeps
     the renderer and its other plugins, and its Deck Shelves renders in place.
     Plain coexistence (loader, no force) stays tab-only (host NOT published). */
  const COOP = _otherLoader && FORCE_OWNER;
  const COEXIST = _otherLoader; // any loader present → no scan, borrow its UI
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
    if (!NATIVE_QAM_REQUESTED && !COOP) {
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
  const I18N = (function () {
    const PREFIXES = [
      ["pt-pt", "pt-PT"], ["pt", "pt-BR"], ["es-es", "es-ES"], ["es", "es-419"],
      ["it", "it-IT"], ["fr-ca", "fr-CA"], ["fr", "fr-FR"], ["de", "de-DE"],
      ["ru", "ru-RU"], ["pl", "pl-PL"], ["nl", "nl-NL"], ["tr", "tr-TR"],
      ["uk", "uk-UA"], ["ja", "ja-JP"], ["ko", "ko-KR"], ["zh-tw", "zh-TW"],
      ["zh-hant", "zh-TW"], ["zh", "zh-CN"], ["en-gb", "en-GB"],
    ];
    /* Dictionaries live in dedicated per-locale JSON files under runtime/i18n/;
       the daemon inlines them as `window.__SHELVES_I18N__` at injection time (this
       runtime is an injected blob and cannot read the files itself). en-US is the
       fallback for any missing locale/key. */
    const DICTS = (function () {
      try {
        if (window.__SHELVES_I18N__ && typeof window.__SHELVES_I18N__ === "object") {
          return window.__SHELVES_I18N__;
        }
      } catch (e) {}
      return {};
    })();
    function pickLocale(l) {
      l = (l || "en-US").toLowerCase();
      for (let i = 0; i < PREFIXES.length; i++) {
        if (l.indexOf(PREFIXES[i][0]) === 0) return PREFIXES[i][1];
      }
      return "en-US";
    }
    let LOCALE = "en-US";
    try { LOCALE = pickLocale(navigator && navigator.language); } catch (e) {}
    // Active locale is resolved per-call so a `window.__SHELVES_LOCALE__` override
    // (a language tag like "en-US") switches the UI language live — used for
    // documentation screenshots and locale testing; falls back to the boot locale.
    function activeLocale() {
      try { if (window.__SHELVES_LOCALE__) return pickLocale(String(window.__SHELVES_LOCALE__)); } catch (e) {}
      return LOCALE;
    }
    function t(key) {
      const d = DICTS[activeLocale()];
      if (d && key in d) return d[key];
      const en = DICTS["en-US"];
      if (en && key in en) return en[key];
      return key;
    }
    return { t: t, locale: LOCALE, pickLocale: pickLocale, activeLocale: activeLocale };
  })();

  // ── Steam webpack: module cache + finders ─────────────────────────────────
  const Steam = (function () {
    const modules = new Map(); // id -> module
    let req = null, captureTried = false;

    function capture() {
      if (req || captureTried) return;
      captureTried = true;
      try {
        const key = Object.keys(window).filter(function (k) {
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
      const cache = req.c;
      if (cache && typeof cache === "object") {
        const cids = Object.keys(cache);
        for (let i = 0; i < cids.length; i++) {
          if (modules.has(cids[i])) continue;
          try { const mod = cache[cids[i]]; const ex = mod && mod.exports; if (ex) modules.set(cids[i], ex); } catch (e) {}
        }
        if (modules.size > 0) return; // cache had modules — done, no force-require
      }
      // Last resort (cache empty — nothing loaded yet): force-require. Heavy;
      // only runs when there is no cache to read from at all.
      if (!req.m) return;
      const ids = Object.keys(req.m);
      for (let j = 0; j < ids.length; j++) {
        if (modules.has(ids[j])) continue;
        try { const m = req(ids[j]); if (m) modules.set(ids[j], m); } catch (e) {}
      }
    }

    function findModule(filter) {
      init();
      const it = modules.values();
      for (let n = it.next(); !n.done; n = it.next()) {
        const m = n.value;
        try {
          if (m && m.default && filter(m.default)) return m.default;
          if (filter(m)) return m;
        } catch (e) {}
      }
    }

    function findModuleDetailsByExport(filter, minExports) {
      init();
      const it = modules.entries();
      for (let n = it.next(); !n.done; n = it.next()) {
        const id = n.value[0], m = n.value[1];
        if (!m) continue;
        const variants = [m.default, m];
        for (let vi = 0; vi < variants.length; vi++) {
          const mod = variants[vi];
          if (typeof mod !== "object" || mod === window) continue;
          if (minExports && Object.keys(mod).length < minExports) continue;
          for (const exportName in mod) {
            let ex;
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
    let _stack = null;
    function getReactStack() {
      if (_stack) return _stack;
      const w = window;
      const React = (w.SP_REACT && w.SP_REACT.createElement) ? w.SP_REACT
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
      let ReactDOM = (w.SP_REACTDOM && w.SP_REACTDOM.createPortal) ? w.SP_REACTDOM
        : findModule(function (m) {
            return m && typeof m.createPortal === "function";
          });
      let jsx = (w.SP_JSX && w.SP_JSX.jsx) ? w.SP_JSX
        : findModule(function (m) {
            return m && typeof m.jsx === "function" && typeof m.jsxs === "function";
          });
      if (!jsx) {
        // Fallback: build jsx from React — jsx(type, config, key) carries
        // children/key in the config object, which createElement accepts.
        const mk = function (type, config, key) {
          let props = config || {};
          if (key !== undefined && key !== null) { props = Object.assign({}, props); props.key = key; }
          return React.createElement(type, props);
        };
        jsx = { Fragment: React.Fragment, jsx: mk, jsxs: mk, jsxDEV: mk };
      }
      let client = (w.SP_REACTDOM_CLIENT && w.SP_REACTDOM_CLIENT.createRoot) ? w.SP_REACTDOM_CLIENT
        : findModule(function (m) {
            return m && typeof m.createRoot === "function" && typeof m.hydrateRoot === "function";
          });
      if (!client && ReactDOM && typeof ReactDOM.createRoot === "function") client = ReactDOM;
      /* React 19 splits the portal API (react-dom) from the root API
         (react-dom/client); expose a ReactDOM carrying BOTH so the bundle's
         react-dom (createPortal) and react-dom-client (createRoot) shims are both
         satisfied from `host.ReactDOM`. */
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

  const ReactStack = Steam.getReactStack();
  const React = ReactStack.React;
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
    let s = fromStart ? "const\\{" : "";
    for (let i = 0; i < props.length; i++) {
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
  const UI = {};
  let uiReady = false;
  let _commonValues = [];
  /* Discovery split into independent steps. One scan off-render is safe (~25ms),
     but several back-to-back block the main thread long enough to starve the
     running plugin in coexistence and collapse the Steam UI (observed on-device).
     So sole-host runs all steps at once at inject (no other plugin to starve);
     coexistence runs ONE STEP PER IDLE TICK (ensureUiChunked), yielding between. */
  const uiSteps = [
    function () {
      const CommonUIModule = Steam.findModule(function (m) {
        if (typeof m !== "object") return false;
        for (const prop in m) {
          try { if (m[prop] && m[prop].contextType && m[prop].contextType._currentValue && Object.keys(m).length > 60) return true; } catch (e) {}
        }
        return false;
      });
      _commonValues = CommonUIModule ? Object.values(CommonUIModule) : [];
      UI.ToggleField = _commonValues.find(function (mod) {
        const s = renderSrc(mod);
        return s.indexOf("ToggleField,fallback") >= 0 || s.indexOf('ToggleField",') >= 0;
      });
      const buttonItemRegex = propListRegex(["highlightOnFocus", "childrenContainerWidth"], false);
      UI.ButtonItem = _commonValues.find(function (mod) {
        const s = renderSrc(mod);
        return buttonItemRegex.test(s) || s.indexOf('childrenContainerWidth:"min"') >= 0;
      });
      // DialogButton — a bare focusable button (not Field-wrapped like ButtonItem).
      // This is what the bundle itself renders in the QAM (its shim maps its buttons
      // to DialogButton), so it is a component proven to render in the injected tab.
      UI.DialogButton = _commonValues.find(function (mod) {
        const s = renderSrc(mod);
        return s.indexOf('"DialogButton"') >= 0 && s.indexOf('"_DialogLayout"') >= 0;
      });
      UI.SliderField = _commonValues.find(function (mod) {
        const s = srcOf(mod);
        return s.indexOf("SliderField,fallback") >= 0 || s.indexOf('SliderField",') >= 0;
      });
    },
    function () {
      const focusableRegex = propListRegex(["flow-children", "onActivate", "onCancel", "focusClassName", "focusWithinClassName"]);
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
      const panelDetails = Steam.findModuleDetailsByExport(function (e) { return srcOf(e).indexOf(".PanelSection") >= 0; });
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
      const showModalRaw = Steam.findModuleExport(function (e) {
        return typeof e === "function" && srcOf(e).indexOf("props.bDisableBackgroundDismiss") >= 0 && !(e.prototype && e.prototype.Cancel);
      });
      if (showModalRaw) {
        UI.showModal = function (modal, parent, props) {
          props = props || {};
          return showModalRaw(modal, parent || window, props.strTitle || "ShelvesHub", props, undefined, { bHideActions: props.bHideActionIcons });
        };
      }
      UI.ConfirmModal = Steam.findModuleExport(function (e) {
        const s = srcOf(e);
        return s.indexOf("bUpdateDisabled") >= 0 && s.indexOf("closeModal") >= 0 && s.indexOf("onGamepadCancel") >= 0;
      });
      UI.showContextMenu = Steam.findModuleExport(function (e) {
        const s = srcOf(e);
        return typeof e === "function" && s.indexOf("GetContextMenuManagerFromWindow(") >= 0 && s.indexOf(".CreateContextMenuInstance(") >= 0;
      });
    },
    function () {
      // Context menu + form inputs.
      const menuDetails = Steam.findModuleDetailsByExport(function (e) {
        return renderSrc(e).indexOf("bPlayAudio:") >= 0 || (e && e.prototype && e.prototype.OnOKButton && e.prototype.OnMouseEnter);
      });
      UI.Menu = Steam.findModuleExport(function (e) {
        return e && e.prototype && e.prototype.HideIfSubmenu && e.prototype.HideMenu;
      }) || (menuDetails && menuDetails[0]
        ? Object.values(menuDetails[0]).find(function (e) { const s = srcOf(e); return s.indexOf("useId") >= 0 && s.indexOf("labelId") >= 0; })
        : undefined);
      UI.MenuItem = menuDetails ? menuDetails[1] : undefined;
      UI.Dropdown = _commonValues.find(function (m) { return m && m.prototype && m.prototype.SetSelectedOption && m.prototype.BuildMenu; });
      const ddRe = propListRegex(["dropDownControlRef", "description"], false);
      const ddInternal = _commonValues.find(function (m) { return m && ddRe.test(srcOf(m)); });
      if (ddInternal) UI.DropdownItem = function (props) { return h(ddInternal, Object.assign({ childrenContainerWidth: "min" }, props || {})); };
      UI.TextField = _commonValues.find(function (m) { return m && m.validateUrl && m.validateEmail; });
    },
    function () {
      // Tabs, Spinner, and Navigation (the plugin's screen routing + Back).
      const tabsModule = Steam.findModuleByExport(function (e) {
        const s = srcOf(e); return s.indexOf(".TabRowTabs") >= 0 && s.indexOf("activeTab:") >= 0;
      });
      if (tabsModule) UI.Tabs = Object.values(tabsModule).find(function (e) { return e && e.type && srcOf(e.type).indexOf("(function()") >= 0; });
      UI.Spinner = Steam.findModuleExport(function (e) {
        const s = srcOf(e); return s.indexOf("Steam Spinner") >= 0 && s.indexOf("src") >= 0;
      });
      // Navigation: the module carrying `Navigate` + `NavigationManager` (stable),
      // OR — on newer clients (beta/desktop) where that module is gone — the
      // `SteamUIStore` navigation surface. `navFn` prefers the focused window's
      // own method, then falls back to `SteamUIStore[name]`, so screen routing
      // (About/Settings + Back) works on both. Without this the plugin's
      // `Navigation.Navigate` degrades to a no-op in sole mode on the beta.
      const Router = Steam.findModuleExport(function (e) { return e && e.Navigate && e.NavigationManager; });
      let SUS = null; try { SUS = window.SteamUIStore; } catch (e) {}
      if (Router || (SUS && typeof SUS.Navigate === "function")) {
        const navFn = function (name, handler) {
          return function () {
            let win = null;
            try { if (SUS && SUS.GetFocusedWindowInstance) win = SUS.GetFocusedWindowInstance(); } catch (e) {}
            if (!win && Router && Router.WindowStore) win = Router.WindowStore.GamepadUIMainWindowInstance || (Router.WindowStore.SteamUIWindows && Router.WindowStore.SteamUIWindows[0]) || null;
            try {
              const t = (handler && win) ? handler(win) : win;
              if (t && typeof t[name] === "function") return t[name].apply(t, arguments);
              if (win && typeof win[name] === "function") return win[name].apply(win, arguments);
              if (SUS && typeof SUS[name] === "function") return SUS[name].apply(SUS, arguments);
              log("nav: no target for " + name);
            } catch (e) { log("nav " + name + ":", e && e.message); }
          };
        };
        const navigator = function (w) { return w.Navigator; };
        const menuStore = function (w) { return w.MenuStore; };
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
          NavigateToLayoutPreview: (Router && Router.NavigateToLayoutPreview) ? Router.NavigateToLayoutPreview.bind(Router) : undefined,
          OpenPowerMenu: (Router && Router.OpenPowerMenu) ? Router.OpenPowerMenu.bind(Router) : undefined
        };
      }
    },
    function () {
      /* Structural dialog components (DialogBody / DialogControlsSection): Steam
         exposes these as div wrappers distinguishable only by the class name they
         render, so render each candidate with empty props and map by the leading
         class name (guarded — a render can throw). */
      const byClass = {};
      _commonValues.forEach(function (m) {
        if (!m || typeof m !== "object") return;
        const rs = renderSrc(m);
        if (rs.indexOf('jsx)("div",{...') < 0 && rs.indexOf('jsx)("div",Object.assign({},') < 0 &&
          rs.indexOf('createElement("div",{...') < 0 && rs.indexOf('createElement("div",Object.assign({},') < 0) return;
        try {
          const el = m.render({});
          const cn = el && el.props && el.props.className;
          if (cn) { const key = cn.split(" ")[0]; if (!byClass[key]) byClass[key] = m; }
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
    for (let i = 0; i < uiSteps.length; i++) runUiStep(i);
    return UI;
  }
  function ensureUiChunked(onDone) {
    if (uiReady || !React) { if (onDone) onDone(); return; }
    uiReady = true;
    let i = 0;
    const t0 = Date.now();
    /* A plain timer, NOT requestIdleCallback: Steam's renderer is never idle, so
       the idle callback never fires. The gap between ticks lets the renderer breathe
       so a single short step (~25ms, measured safe) never stalls the main thread.
       In sole mode the bundle boot is GATED behind this scan (nothing else is
       running to starve), so a small gap is enough and keeps cold-start snappy. */
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
  /* Publish "Steam's UI is populated" as a window global so the preload gate can
     defer the bundle boot until host.ui is ready (the bundle reads host.ui.* at
     boot). Coexist sets it synchronously (the borrow below); sole-host sets it
     from the chunked scan's onDone. Idempotent + safe if window is unavailable. */
  function signalUiReady() { try { window.__SHELVES_UI_READY__ = true; } catch (e) {} }
  /* Sole host: no loader to borrow from, so the webpack must be scanned for Steam's
     UI — but CHUNKED (one step per timer tick), NEVER the sync all-at-once scan,
     which stalls the main thread at boot → black screen. Signal readiness when the
     scan lands so the preload gate releases the bundle only once host.ui exists. */
  if (React && !COEXIST) ensureUiChunked(function () { augmentHostUi(signalUiReady); });
  /* Coexist: the loader already resolved every Steam UI component — borrow them
     directly. A webpack discovery scan on the INJECT path (even chunked) stalls the
     renderer main thread long enough to collapse the Steam UI windows (black
     screen), and it runs on every inject with the QAM closed. Borrowing avoids the
     scan entirely; the scan remains only as the sole-host / no-lib fallback below. */
  if (React && COEXIST) {
    try {
      const _lib = window.DFL || window.deckyFrontendLib;
      if (_lib) {
        ["Focusable", "ButtonItem", "DialogButton", "ToggleField", "SliderField", "Field", "PanelSection", "PanelSectionRow"].forEach(function (k) {
          if (_lib[k]) UI[k] = _lib[k];
        });
        // Cooperative ownership renders the loader's Deck Shelves on OUR host, so
        // host.ui must be the FULL component surface — copy every export the loader
        // resolved (still no scan; these are already-resolved references).
        if (COOP) {
          Object.keys(_lib).forEach(function (k) { if (UI[k] == null) UI[k] = _lib[k]; });
        }
        if (UI.Focusable) uiReady = true;
        log("QAM UI: borrowed from loader (no scan) — " + Object.keys(UI).length + " components.");
      }
    } catch (e) {}
    // Coexist UI is ready synchronously (borrowed above, or the bundle is dormant
    // under the loader anyway) — release the bundle gate now, no wait.
    signalUiReady();
  }

  /* Steam's Focusable — the single component the QAM tab panel needs to join
     Steam's gamepad-focus navigation (a loader wraps its plugin view in it). It is
     discovered on demand OFF the render path (scheduled in QamHost): one webpack
     scan, which black-screens if run during a React render but is safe when the
     renderer is idle. Reuses UI.Focusable when the sole-host path already found it. */
  let focusableComp = null;
  let focusableTried = false;
  function ensureFocusable() {
    if (focusableComp) return focusableComp;
    if (UI.Focusable) { focusableComp = UI.Focusable; return focusableComp; }
    if (focusableTried || !React) return focusableComp;
    focusableTried = true;
    try {
      const re = propListRegex(["flow-children", "onActivate", "onCancel", "focusClassName", "focusWithinClassName"]);
      focusableComp = Steam.findModuleExport(function (e) {
        return (typeof e === "function" && re.test(srcOf(e))) || re.test(renderSrc(e));
      }) || null;
      log("QAM Focusable: " + (focusableComp ? "found" : "not found") + ".");
    } catch (e) { log("QAM Focusable discovery:", e && e.message); }
    return focusableComp;
  }
  /* Native-component rendering (verified safe once discovery stopped scanning on
     the inject path). ON by default; set window.__SHELVES_NATIVE_UI__ = false as a
     kill switch. It renders only when the components are actually present anyway
     (the branches also gate on UI.DialogButton/UI.ToggleField). */
  function nativeUiOn() { try { return window.__SHELVES_NATIVE_UI__ !== false; } catch (e) { return true; } }

  // A minimal error boundary so a bad panel render shows a fallback instead of
  // crashing the Steam renderer.
  let ErrorBoundary = null;
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
    const f = function () {
      let ret = origFn.apply(this, arguments);
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
    const orig = object[property];
    const patch = {
      object: object, property: property, handler: handler, original: orig,
      patchedFunction: null, hasUnpatched: false,
      unpatch: function () {
        if (patch.hasUnpatched) return;
        try { object[property] = patch.original; } catch (e) {}
        patch.hasUnpatched = true;
      },
    };
    let replacement; const tag = reactTag(orig);
    if (tag && tag.indexOf("react.memo") >= 0 && orig.type) {
      // memo → React renders memo.type(props); wrap the inner render component.
      const memo = {}; for (const mk in orig) memo[mk] = orig[mk];
      memo.type = wrapRenderFn(orig.type, handler, options, patch);
      replacement = memo;
    } else if (tag && tag.indexOf("react.forward_ref") >= 0 && typeof orig.render === "function") {
      const fr = {}; for (const fk in orig) fr[fk] = orig[fk];
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
      for (let i = 0; i < parent.length; i++) { const r = findInTree(parent[i], filter, walkable); if (r) return r; }
      return null;
    }
    const keys = walkable || Object.keys(parent);
    for (let k = 0; k < keys.length; k++) {
      let v; try { v = parent[keys[k]]; } catch (e) { continue; }
      const found = findInTree(v, filter, walkable);
      if (found) return found;
    }
    return null;
  }
  function findInReactTree(node, filter) {
    return findInTree(node, filter, ["props", "children", "child", "sibling"]);
  }

  function getReactRoot(el) {
    if (!el) return null;
    let fiber = null;
    const k = Object.keys(el).find(function (x) { return x.indexOf("__reactContainer$") === 0; });
    if (k) fiber = el[k];
    else if (el._reactRootContainer && el._reactRootContainer._internalRoot) fiber = el._reactRootContainer._internalRoot.current;
    if (!fiber) return null;
    /* The container key holds a FIXED HostRoot fiber; after a render the live
       tree may be on its alternate (React double-buffers the two HostRoot
       fibers). Resolve to the FiberRoot's `current` so callers always walk the
       mounted tree — otherwise a re-point can land on the empty back-buffer. */
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
    const routes = new Map(); // path -> { component, props }
    const routePatches = new Map(); // path -> Set<patch>
    const globalComponents = new Map(); // id -> component (always-rendered, e.g. the home bridge)
    let RouteComp = null;
    let patched = false;
    let wrapperInserted = false; // true once our stateful wrapper is in the live tree
    const OUR_ARRAY = "__shelvesRoutes"; // marks the sub-array we append
    const IS_PATCHED = "__shelvesRoutePatched"; // marks an already-patched route

    // Minimal router-state store: the mounted
    // wrapper components subscribe; a route/patch/global change calls bump() to
    // re-render them CLEANLY via React state — instead of the old fiber-repoint
    // force, which mutated the router fiber out-of-band and left Steam's gamepad
    // FocusNavController unable to register our route subtree (unfocusable pages),
    // besides flashing the previous route back on repeated re-renders.
    const listeners = new Set();
    function bump() { listeners.forEach(function (l) { try { l(); } catch (e) {} }); }
    function subscribe(l) { listeners.add(l); return function () { listeners["delete"](l); }; }

    /* FALLBACK Route resolution: reuse the type of an existing route in the live
       list. Only used if the source-regex (findRoute) fails on some future client.
       NOTE: this yields Steam's route WRAPPER (e.g. `/library/home` = a services-
       gated wrapper), not the raw Route — so it can carry unwanted context; the raw
       Route from findRoute is preferred. Cached once resolved. */
    function routeTypeFromList(routeList) {
      if (RouteComp) return RouteComp;
      if (!routeList) return null;
      let first = null;
      for (let i = 0; i < routeList.length; i++) {
        const el = routeList[i];
        if (el && el.type && el.props && typeof el.props.path === "string") {
          if (!first) first = el.type;
          if (el.props.path === "/library/home") { RouteComp = el.type; break; }
        }
      }
      if (!RouteComp) RouteComp = first;
      if (RouteComp && routerDebug()) log("[dbg] routeTypeFromList: " + typeName(RouteComp));
      return RouteComp;
    }

    /* PRIMARY Route resolution: discover the raw react-router Route via webpack
       source-regex (the component whose body contains `routePath:X.match?.path`).
       The raw component carries no wrapper context, so our pages integrate into
       Steam's gamepad focus/back like the platform's own routes. */
    function findRoute() {
      if (RouteComp) return RouteComp;
      try {
        const mod = Steam.findModuleByExport(function (e) { return e === "router-backstack"; }, 20);
        if (mod) {
          // multi-char (`[\w$]+`) and KEEP the trailing `.` (any char). An
          // earlier attempt used `[.=]` for the trailing token, which is stricter
          // than the original `.` and matched nothing on the beta.
          RouteComp = Object.values(mod).find(function (e) {
            return typeof e === "function" && /routePath:[\w$]+\.match\?\.path./.test(srcOf(e));
          }) || null;
        }
      } catch (e) { log("routerHook: Route discovery:", e && e.message); }
      return RouteComp;
    }

    // Apply registered patches to the existing routes in one route-list array.
    function applyPatches(routeList) {
      for (let i = 0; i < routeList.length; i++) {
        const route = routeList[i];
        if (!route || !route.props || !route.props.path) continue;
        const set = routePatches.get(route.props.path);
        if (!set || !set.size) continue;
        if (route.props.children && route.props.children[IS_PATCHED]) continue;
        set.forEach(function (patch) {
          try {
            const res = patch(Object.assign({}, route.props));
            if (res && res.children !== undefined) route.props.children = res.children;
          } catch (e) { log("routePatch:", route.props.path, e && e.message); }
        });
        try { if (route.props.children) route.props.children[IS_PATCHED] = true; } catch (e) {}
      }
    }

    // Build our route elements ONCE per (route-set, Route-type) and CACHE the
    // resulting array. Steam rebuilds the route-list array on every render, so
    // the old code — which rebuilt fresh, UNKEYED route elements each render —
    // gave React new child identities every frame: react-router re-mounted our
    // routes and Steam's FocusNavController lost track of focus (home shelves
    // unfocusable) while a matched route re-appeared after any input (sticky).
    // A cached array of KEYED elements keeps stable identities across renders, so
    // React reconciles in place — no re-mount, no focus loss, no stickiness.
    let builtRoutes = null, builtSig = "", builtType = null;
    function buildOurRoutes(Route) {
      let sig = [];
      routes.forEach(function (_e, p) { sig.push(p); });
      sig = sig.sort().join("|");
      if (builtRoutes && builtSig === sig && builtType === Route) return builtRoutes;
      const arr = [];
      arr[OUR_ARRAY] = true;
      routes.forEach(function (entry, path) {
        const inner = React.createElement(entry.component);
        const body = ErrorBoundary ? React.createElement(ErrorBoundary, null, inner) : inner;
        // No `key` (`<Route path={path} {...props}>`): the array is stable/cached,
        // so index reconciliation is stable without keys.
        arr.push(React.createElement(Route, Object.assign({ path: path }, entry.props || {}), body));
      });
      builtRoutes = arr; builtSig = sig; builtType = Route;
      return arr;
    }

    // APPEND our routes (as the stable cached nested array — React flattens it) at
    // the END of the main route-list array. Two facts make this correct and
    // focus-safe on both stable and beta:
    //   1. Steam's own route elements are UNKEYED, so appending leaves them at
    //      their original positions — React reconciles them by position and never
    //      re-mounts them (prepending would shift every position → a full remount →
    //      the gamepad focus loss + sticky routes we saw earlier).
    //   2. The Switch's catch-all (`path:['/','/index.html','/sp.html']`) is
    //      `exact`, so it does NOT shadow a trailing `/deck-shelves/*` route.
    // Our nested array is the SAME cached object across renders with KEYED children,
    // so React keeps our routes' identities stable too (no re-mount, no stickiness).
    function injectRoutes(routeList) {
      if (!routes.size) return;
      // Prefer the RAW react-router Route (findRoute): reusing a route's wrapper
      // type pulls in its own context/guards, disturbing gamepad focus/back for our
      // pages. Tree-reuse (routeTypeFromList) is the fallback if the regex misses.
      const Route = findRoute() || routeTypeFromList(routeList);
      if (!Route) { if (routerDebug()) log("[dbg] injectRoutes: no Route type resolved"); return; }
      const arr = buildOurRoutes(Route);
      /* Reuse the slot: the wrapper re-renders on every route-state
         change but operates on the SAME route-list array, so pushing unconditionally
         would DUPLICATE our routes on each re-render. If our array is already the
         last slot, replace it in place; otherwise append once. */
      const last = routeList.length ? routeList[routeList.length - 1] : null;
      if (last && last[OUR_ARRAY]) routeList[routeList.length - 1] = arr;
      else routeList.push(arr);
    }

    /* DEBUG (read-only): describe an element tree compactly so we can see the
       real router render structure on a given client — element type name, which
       children are arrays (and their lengths), and any Route (props.path). Gated
       behind window.__SHELVES_ROUTER_DEBUG__ so it never runs on the normal path. */
    function typeName(t) {
      if (t == null) return String(t);
      if (typeof t === "string") return t;
      if (t === React.Fragment) return "Fragment";
      const n = t.displayName || t.name;
      if (n) return n;
      try { const s = srcOf(t); return "fn<" + s.slice(0, 40).replace(/\s+/g, " ") + ">"; } catch (e) { return "fn"; }
    }
    function describe(el, depth, path) {
      if (depth > 6 || el == null) return;
      if (Array.isArray(el)) {
        log("  [dbg] " + path + " ARRAY len=" + el.length);
        for (let i = 0; i < el.length && i < 12; i++) describe(el[i], depth + 1, path + "[" + i + "]");
        return;
      }
      if (typeof el !== "object" || !el.props) return;
      const pth = el.props.path !== undefined ? (" path=" + JSON.stringify(el.props.path)) : "";
      const ch = el.props.children;
      const chKind = Array.isArray(ch) ? ("array(" + ch.length + ")") : (ch && ch.props ? "elem" : (ch == null ? "none" : typeof ch));
      log("  [dbg] " + path + " <" + typeName(el.type) + ">" + pth + " children=" + chKind);
      if (Array.isArray(ch)) { for (let j = 0; j < ch.length && j < 12; j++) describe(ch[j], depth + 1, path + ".children[" + j + "]"); }
      else if (ch && ch.props) describe(ch, depth + 1, path + ".children");
    }
    function routerDebug() { try { return !!window.__SHELVES_ROUTER_DEBUG__; } catch (e) { return false; } }

    // Inject our routes + apply our patches into the router's output. Its output
    // (confirmed on stable AND beta) is a Fragment with two children, each a
    // container whose `children` is a route-list array: [0] = MAIN routes,
    // [1] = in-game routes. We patch every list (home shelves live on
    // `/library/home` in the main list) and append our routes into the main list.
    // This runs INSIDE the wrapper component below (a real mounted component), so
    // Steam's focus system registers the resulting subtree normally.
    function processLists(routerOutput) {
      if (!routerOutput || !routerOutput.props) return;
      if (routerDebug()) { try { window.__DBG_RET__ = routerOutput; } catch (e) {} }
      const top = routerOutput.props.children;
      const containers = Array.isArray(top) ? top : [top];
      const lists = [];
      for (let i = 0; i < containers.length; i++) {
        const c = containers[i];
        if (c && c.props && Array.isArray(c.props.children)) lists.push(c.props.children);
      }
      for (let j = 0; j < lists.length; j++) applyPatches(lists[j]);
      if (lists.length) injectRoutes(lists[0]);
      try {
        const st = (window.__SHELVES_ROUTER_STATS__ = window.__SHELVES_ROUTER_STATS__ || { renders: 0 });
        st.renders++; st.lists = lists.length; st.mainLen = lists.length ? lists[0].length : 0;
        st.routeType = RouteComp ? typeName(RouteComp) : null; st.ourRoutes = routes.size; st.builtLen = builtRoutes ? builtRoutes.length : 0;
      } catch (e) {}
    }

    // The stateful route wrapper: it receives the router's own output as
    // `children`, injects into that output's
    // route lists on render, then returns it unchanged. Because the injection now
    // happens in a normally-mounted component (not an out-of-band fiber mutation),
    // the gamepad focus tree registers our route pages. Subscribes to the router
    // state so a later addRoute/addPatch re-renders it without touching the fiber.
    function ShelvesRouterWrapper(props) {
      const st = React.useState(0);
      React.useEffect(function () {
        const l = function () { st[1](function (x) { return (x + 1) | 0; }); };
        return subscribe(l);
      }, []);
      try { processLists(props.children); } catch (e) { log("routerHook wrapper:", e && e.message); }
      return props.children;
    }

    // Always-on global components (the home bridge) as their own sibling subtree so
    // they mount on any route and reconcile in place. Home-shelf gamepad-focus
    // registration in sole mode is unresolved and handled separately.
    function ShelvesGlobalWrapper() {
      const st = React.useState(0);
      React.useEffect(function () {
        const l = function () { st[1](function (x) { return (x + 1) | 0; }); };
        return subscribe(l);
      }, []);
      if (!globalComponents.size) return null;
      const extras = [];
      globalComponents.forEach(function (comp, id) {
        try { extras.push(React.createElement(comp, { key: "shg-" + id })); } catch (e) {}
      });
      return React.createElement(React.Fragment, null, extras);
    }

    // Patch on the memoized router's render: wrap its output ONCE in our stateful
    // wrapper (+ a sibling that renders global components). Marked so a re-entry
    // returns as-is (guarded so a re-entry is a no-op).
    function handleRender(_args, ret) {
      try {
        if (!ret || !ret.props) return ret;
        if (routerDebug()) { try { window.__DBG_RET__ = ret; } catch (e) {} log("[dbg] ===== router render dump ====="); describe(ret, 0, "ret"); log("[dbg] ===== end dump ====="); return ret; }
        if (ret.__shelvesWrapped) return ret;
        wrapperInserted = true;
        const out = React.createElement(React.Fragment, { key: "shelves-router-root" },
          React.createElement(ShelvesRouterWrapper, { key: "shelves-router" }, ret),
          React.createElement(ShelvesGlobalWrapper, { key: "shelves-globals" }));
        try { out.__shelvesWrapped = true; } catch (e) {}
        return out;
      } catch (e) { log("routerHook render:", e && e.message); }
      return ret;
    }

    let routerFiber = null; // the mounted route-declaring fiber, for re-rendering

    function ensurePatched() {
      if (patched || !React) return patched;
      try {
        const rf = getReactRoot(document.getElementById("root"));
        if (!rf) return false;
        const node = findInReactTree(rf, function (n) {
          const t = n && (n.elementType || n.type);
          if (!t) return false;
          if (srcOf(t).indexOf("Settings.Root()") >= 0) return true;
          try { if (t.type && srcOf(t.type).indexOf("Settings.Root()") >= 0) return true; } catch (e) {}
          return false;
        });
        if (!node) return false;
        const et = node.elementType || node.type;
        if (!et || typeof et.type !== "function") return false;
        routerFiber = node;
        if (!et.type.__shelvesPatched) { afterPatch(et, "type", handleRender); log("routerHook: router patched."); }
        patched = true;
        return true;
      } catch (e) { logWarn("ROUTER", "patch failed: " + (e && e.message)); return false; }
    }

    // ONE-TIME memo-bust: Steam's route-declaring component is memoized and
    // captured its render fn at mount (before our afterPatch), so it will not
    // re-render on its own to pick up our patched render. To INSERT our wrapper
    // the first time, re-point the live fiber's `type` at the patched fn,
    // invalidate its memo props, and forceUpdate the nearest class ancestor. Once
    // handleRender runs, our wrapper is mounted (`wrapperInserted`) and owns all
    // subsequent updates via React state (bump) — we NEVER touch the fiber again
    // (the repeated fiber-repoint was what broke gamepad focus / flashed routes).
    let forcePending = false;
    function doForce() {
      forcePending = false;
      if (!routerFiber || wrapperInserted) return;
      try {
        const et = routerFiber.elementType;
        if (et && typeof et.type === "function") {
          routerFiber.type = et.type;
          if (routerFiber.alternate) routerFiber.alternate.type = et.type;
        }
        const stamp = { __shForce: Date.now() };
        routerFiber.memoizedProps = Object.assign({}, stamp, routerFiber.memoizedProps);
        if (routerFiber.alternate) routerFiber.alternate.memoizedProps = Object.assign({}, stamp, routerFiber.alternate.memoizedProps || {});
        let p = routerFiber.return, hops = 0;
        while (p && hops++ < 80) {
          if (p.stateNode && typeof p.stateNode.forceUpdate === "function") { p.stateNode.forceUpdate(); return; }
          p = p.return;
        }
        log("routerHook: no updatable ancestor to force.");
      } catch (e) { log("routerHook force:", e && e.message); }
    }
    function scheduleForce() { if (wrapperInserted || forcePending) return; forcePending = true; setTimeout(doForce, 0); }

    // The router node may not be mounted the instant a route is registered — poll
    // until the patch lands (idempotent; capped), then do the one-time insert force.
    let tries = 0;
    function ensureWithRetry() {
      if (ensurePatched()) { scheduleForce(); return; }
      if (tries++ < 400) setTimeout(ensureWithRetry, 100);
    }

    // A registration change: once the wrapper is mounted, re-render it cleanly via
    // React state (bump) — no fiber force. Before that, ensure the router is
    // patched and do the one-time insert force.
    function requestUpdate() { if (wrapperInserted) { bump(); } else { ensureWithRetry(); } }

    return {
      addRoute: function (path, component, props) { log("routerHook.addRoute", path); routes.set(path, { component: component, props: props || {} }); requestUpdate(); },
      removeRoute: function (path) { routes["delete"](path); requestUpdate(); },
      addPatch: function (path, patch) { log("routerHook.addPatch", path); if (!routePatches.has(path)) routePatches.set(path, new Set()); routePatches.get(path).add(patch); requestUpdate(); return patch; },
      removePatch: function (path, patch) { const s = routePatches.get(path); if (s) s["delete"](patch); requestUpdate(); return patch; },
      /* Always-on global components (the plugin's home bridge, which renders
         elsewhere and PORTALS the shelves into its own mount). Rendered by
         ShelvesGlobalWrapper as a stable sibling subtree — mounted once, reconciled
         in place (no re-mount, no leaked subscriptions). */
      addGlobalComponent: function (a, b) {
        let id, comp;
        if (typeof a === "string") { id = a; comp = b; }
        else if (a && a.component) { id = a.id || ("g" + globalComponents.size); comp = a.component; }
        else { comp = a; id = (a && (a.displayName || a.name)) || ("g" + globalComponents.size); }
        if (!comp) return function () {};
        log("routerHook.addGlobalComponent", id);
        globalComponents.set(id, comp);
        requestUpdate();
        return function () { globalComponents["delete"](id); requestUpdate(); };
      },
      removeGlobalComponent: function (a) {
        if (typeof a === "string") { globalComponents["delete"](a); }
        else if (a && a.id) { globalComponents["delete"](a.id); }
        else { globalComponents.forEach(function (v, k) { if (v === a) globalComponents["delete"](k); }); }
        requestUpdate();
      }
    };
  }
  const routerHook = makeRouterHook();

  /* ── QAM: register a native tab in the Quick Access Menu ───────────────────
     The tab-list builder hook returns the tabs array; we append our tab(s) to
     its output (non-destructive). Overlay panel is the fallback and the
     immediate path. See installPatch below for the mechanism and its timing. */
