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
      function resolveMenuStore() {
        const inst = g.SteamUIStore && g.SteamUIStore.WindowStore && g.SteamUIStore.WindowStore.GamepadUIMainWindowInstance;
        const ms = inst && inst.m_MenuStore;
        return (ms && typeof ms.CloseSideMenus === "function") ? ms : null;
      }
      function shouldStop() {
        return (closes > 0 && stable >= 3) || closes >= 6 || Date.now() - t0 > 10000;
      }
      const iv = setInterval(function () {
        tries++;
        const ms = resolveMenuStore();
        if (!ms) { if (tries > 400) clearInterval(iv); return; }
        if (!t0) t0 = Date.now();
        const st = ms.m_eOpenSideMenu;
        if (st === 1 && closes < 6) { try { ms.CloseSideMenus(); } catch (e) {} closes++; stable = 0; }
        else if (st === 0) { stable++; }
        if (shouldStop()) clearInterval(iv);
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
  // Structured logging: leveled (INFO/WARN/ERROR) + scoped, same shape the plugin uses. Each entry is
  // styled in the console, buffered in `window.__SHELVES_LOG__` (bounded ring), and — WARN/ERROR always,
  // INFO only when `__SHELVES_LOG_VERBOSE__` — forwarded to the daemon via `pushLogs` so getLogs merges.
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
  function _logStyled(scope, level, text) {
    try {
      const sc = LOG_SCOPE_COLOR[scope] || "#8b5cf6";
      const lb = LOG_LEVEL_BG[level] || "#0ea5e9";
      const m = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
      m.call(console, "%cShelvesHub%c" + scope + "%c " + text,
        "background:" + lb + ";color:#04121f;padding:1px 4px;font-weight:800;border-radius:2px 0 0 2px",
        "background:" + sc + ";color:#04121f;padding:1px 4px;font-weight:800;border-radius:0 2px 2px 0",
        "color:#93c5fd;font-weight:600");
    } catch (e) {}
  }
  function hlog(scope, level, msg, ctx) {
    scope = scope || "HOST"; level = level || "INFO";
    const text = ctx === undefined ? String(msg) : String(msg) + " " + _logText([ctx]);
    _logStyled(scope, level, text);
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

  /* Coexistence: never break another host, but always keep OUR tab. Two separable things: (A) install
     `window.__SHELVES_HOST__` (the host API the bundle selects on) — SKIPPED under a loader, else its
     bundle mis-selects our adapter and drops its home patches (the hard safety invariant); (B) add our
     Quick Access tab — additive, ALWAYS runs. `SHELVES_FORCE_OWNER=shelveshub` forces (A) anyway, an
     advanced opt-in that needs the loader adapter to stand down cooperatively. */
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
    // Safety stand-down: when the native tab isn't requested there's nothing to install or patch,
    // so return NOW, before capturing Steam's webpack or enumerating modules. Walking the graph while
    // another loader owns the UI is invasive and a suspected black-screen trigger — stay truly inert.
    if (!NATIVE_QAM_REQUESTED && !COOP) {
      log("Native tab not requested — standing down without touching Steam internals.");
      return;
    }
  }

  // i18n for the host's OWN UI (fallback panel + error text): an ordered prefix→locale map, a
  // navigator-language pick, per-locale dictionaries, and an en-US fallback. Standalone (no
  // framework/fetch) because the plugin's i18n is gone exactly when the bundle fails to load.
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

    // Read already-instantiated modules from the require CACHE (`req.c`) WITHOUT a force-require,
    // so we never run an unloaded factory nor walk the graph (that block starved the plugin →
    // React #31). Returns true when the cache yielded modules.
    function readFromCache() {
      const cache = req.c;
      if (!cache || typeof cache !== "object") return false;
      const cids = Object.keys(cache);
      for (let i = 0; i < cids.length; i++) {
        if (modules.has(cids[i])) continue;
        try { const mod = cache[cids[i]]; const ex = mod && mod.exports; if (ex) modules.set(cids[i], ex); } catch (e) {}
      }
      return modules.size > 0;
    }
    // Last resort (cache empty — nothing loaded yet): force-require every module. Heavy.
    function forceRequireAll() {
      if (!req.m) return;
      const ids = Object.keys(req.m);
      for (let j = 0; j < ids.length; j++) {
        if (modules.has(ids[j])) continue;
        try { const m = req(ids[j]); if (m) modules.set(ids[j], m); } catch (e) {}
      }
    }
    // Incremental: chunks keep loading long after boot starts, so every call picks up modules that
    // appeared since the last (the early-injection path depends on this — the QAM builder loads late).
    function init() {
      capture();
      if (!req) return;
      if (readFromCache()) return; // cache had modules — no force-require
      forceRequireAll();
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

    // Scan ONE module variant's exports for the first that matches `filter`; returns the
    // [mod, export, name, id] tuple or null. Skips non-objects, `window`, and modules below
    // `minExports`.
    function matchInModule(mod, filter, minExports, id) {
      if (typeof mod !== "object" || mod === window) return null;
      if (minExports && Object.keys(mod).length < minExports) return null;
      for (const exportName in mod) {
        let ex;
        try { ex = mod[exportName]; } catch (e) { continue; }
        if (!ex) continue;
        try { if (filter(ex, exportName)) return [mod, ex, exportName, id]; } catch (e) {}
      }
      return null;
    }
    function findModuleDetailsByExport(filter, minExports) {
      init();
      const it = modules.entries();
      for (let n = it.next(); !n.done; n = it.next()) {
        const id = n.value[0], m = n.value[1];
        if (!m) continue;
        const variants = [m.default, m];
        for (let vi = 0; vi < variants.length; vi++) {
          const hit = matchInModule(variants[vi], filter, minExports, id);
          if (hit) return hit;
        }
      }
      return [undefined, undefined, undefined, undefined];
    }

    function findModuleExport(filter, minExports) { return findModuleDetailsByExport(filter, minExports)[1]; }
    function findModuleByExport(filter, minExports) { return findModuleDetailsByExport(filter, minExports)[0]; }

    function isSteam() { init(); return modules.size > 0; }
    // React stack. A loader normally publishes Steam's React/ReactDOM/jsx globals; in owner mode we
    // DISCOVER them from Steam's webpack and expose them on the host (`host.React` etc.) — never as
    // loader-shaped globals (neutral). When one is already present (coexist) we reuse it, skip the scan.
    let _stack = null;
    function discoverReact(w) {
      if (w.SP_REACT && w.SP_REACT.createElement) return w.SP_REACT;
      return findModule(function (m) {
        return m && typeof m.createElement === "function"
          && typeof m.useState === "function"
          && typeof m.Fragment !== "undefined" && m.Component;
      });
    }
    // `createPortal` is the react-dom marker. Do NOT also require `render`/`createRoot`:
    // React 19's react-dom dropped legacy `render` and moved `createRoot` to react-dom/client.
    function discoverReactDOM(w) {
      if (w.SP_REACTDOM && w.SP_REACTDOM.createPortal) return w.SP_REACTDOM;
      return findModule(function (m) { return m && typeof m.createPortal === "function"; });
    }
    function discoverJsx(w, React) {
      if (w.SP_JSX && w.SP_JSX.jsx) return w.SP_JSX;
      const found = findModule(function (m) { return m && typeof m.jsx === "function" && typeof m.jsxs === "function"; });
      if (found) return found;
      // Fallback: build jsx from React — jsx(type, config, key) carries children/key in config.
      const mk = function (type, config, key) {
        let props = config || {};
        if (key !== undefined && key !== null) { props = Object.assign({}, props); props.key = key; }
        return React.createElement(type, props);
      };
      return { Fragment: React.Fragment, jsx: mk, jsxs: mk, jsxDEV: mk };
    }
    function discoverReactClient(w, ReactDOM) {
      let client = (w.SP_REACTDOM_CLIENT && w.SP_REACTDOM_CLIENT.createRoot) ? w.SP_REACTDOM_CLIENT
        : findModule(function (m) { return m && typeof m.createRoot === "function" && typeof m.hydrateRoot === "function"; });
      if (!client && ReactDOM && typeof ReactDOM.createRoot === "function") client = ReactDOM;
      return client;
    }
    /* React 19 splits the portal API (react-dom) from the root API (react-dom/client); return a
       ReactDOM carrying BOTH so the bundle's react-dom (createPortal) and react-dom-client
       (createRoot) shims are both satisfied from `host.ReactDOM`. */
    function mergeRootApi(ReactDOM, client) {
      if (ReactDOM && client && typeof ReactDOM.createRoot !== "function" && typeof client.createRoot === "function") {
        return Object.assign({}, ReactDOM, { createRoot: client.createRoot, hydrateRoot: client.hydrateRoot });
      }
      return ReactDOM;
    }
    function getReactStack() {
      if (_stack) return _stack;
      const w = window;
      const React = discoverReact(w);
      if (!React || !React.createElement) {
        return { React: null, ReactDOM: null, jsx: null, client: null };
      }
      const baseDom = discoverReactDOM(w);
      const client = discoverReactClient(w, baseDom);
      const ReactDOM = mergeRootApi(baseDom, client);
      const jsx = discoverJsx(w, React);
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

  // Steam's platform React globals (SP_REACT / SP_REACTDOM / SP_JSX). This build doesn't set them
  // in this JS context, but the plugin reads them directly (patching SP_REACT.createElement for the
  // menu hook) — so publish the SAME React stack from Steam's webpack when absent (Steam's, neutral).
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

  // Steam's native, gamepad-focusable UI components. `ensureUi` is idempotent: the sole-host path
  // calls it eagerly; under a loader (COEXIST) it's deferred to the hub view's first render (off the
  // boot path) because this scan blocks the main thread and at boot starves the plugin → React #31.
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
    // Extended host.ui surface (sole host): the full plugin UI (screens, dialogs, menus,
    // navigation) needs more than the QAM widgets above. Under a loader the plugin reaches those
    // through the loader; as sole host we resolve Steam's from the webpack, each guarded.
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
      // Navigation: the module carrying `Navigate` + `NavigationManager` (stable), OR — on newer
      // clients where that's gone — the `SteamUIStore` navigation surface. `navFn` prefers the
      // focused window's method, falling back to `SteamUIStore[name]`, so routing works on both.
      const Router = Steam.findModuleExport(function (e) { return e && e.Navigate && e.NavigationManager; });
      let SUS = null; try { SUS = window.SteamUIStore; } catch (e) {}
      if (Router || (SUS && typeof SUS.Navigate === "function")) {
        // The focused window instance, else the main gamepad window (or the first Steam UI window).
        const resolveWindow = function () {
          let win = null;
          try { if (SUS && SUS.GetFocusedWindowInstance) win = SUS.GetFocusedWindowInstance(); } catch (e) {}
          if (!win && Router && Router.WindowStore) {
            win = Router.WindowStore.GamepadUIMainWindowInstance || (Router.WindowStore.SteamUIWindows && Router.WindowStore.SteamUIWindows[0]) || null;
          }
          return win;
        };
        // Call `name` on the first target that has it; { ok, value }.
        const invokeNav = function (name, targets, args) {
          for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            if (t && typeof t[name] === "function") return { ok: true, value: t[name].apply(t, args) };
          }
          return { ok: false };
        };
        const navFn = function (name, handler) {
          return function () {
            const win = resolveWindow();
            try {
              const t = (handler && win) ? handler(win) : win;
              const r = invokeNav(name, [t, win, SUS], arguments);
              if (r.ok) return r.value;
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
      const rendersDivWrapper = function (rs) {
        return rs.indexOf('jsx)("div",{...') >= 0 || rs.indexOf('jsx)("div",Object.assign({},') >= 0 ||
          rs.indexOf('createElement("div",{...') >= 0 || rs.indexOf('createElement("div",Object.assign({},') >= 0;
      };
      _commonValues.forEach(function (m) {
        if (!m || typeof m !== "object") return;
        if (!rendersDivWrapper(renderSrc(m))) return;
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

  // React tree patch helpers
  /* GenericPatchHandler (args, ret) => newRet, mirroring the tree-patcher semantics the plugin's
     menu/recents code relies on (same plugin works here as under a loader, internals neutrally
     named). The plugin patches `element.type` slots directly, which on this Steam are often a
     `memo` OBJECT or `forwardRef` — so afterPatch PRESERVES the original's shape (wraps a memo's
     inner `.type`, a forwardRef's `.render`, or a plain fn) and binds `this` for class handlers. */
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
  // Build the wrapped replacement preserving the original's React shape: a memo (wrap its inner
  // `.type`), a forwardRef (wrap its `.render`), or a plain function. null = nothing to wrap.
  function buildReplacement(orig, handler, options, patch) {
    const tag = reactTag(orig);
    if (tag && tag.indexOf("react.memo") >= 0 && orig.type) {
      const memo = {}; for (const mk in orig) memo[mk] = orig[mk];
      memo.type = wrapRenderFn(orig.type, handler, options, patch);
      return memo;
    }
    if (tag && tag.indexOf("react.forward_ref") >= 0 && typeof orig.render === "function") {
      const fr = {}; for (const fk in orig) fr[fk] = orig[fk];
      fr.render = wrapRenderFn(orig.render, handler, options, patch);
      return fr;
    }
    if (typeof orig === "function") return wrapRenderFn(orig, handler, options, patch);
    return null;
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
    const replacement = buildReplacement(orig, handler, options, patch);
    if (!replacement) return patch; // nothing renderable/callable to wrap — leave the slot as-is
    patch.patchedFunction = replacement;
    try { replacement.__shelvesPatch = patch; } catch (e) {}
    try { replacement.__shelvesPatched = true; } catch (e) {}
    object[property] = replacement;
    return patch;
  }

  // findInTree / findInReactTree: recursive search walking the given keys.
  function findInChildren(parent, filter, walkable) {
    const keys = walkable || Object.keys(parent);
    for (let k = 0; k < keys.length; k++) {
      let v; try { v = parent[keys[k]]; } catch (e) { continue; }
      const found = findInTree(v, filter, walkable);
      if (found) return found;
    }
    return null;
  }
  function findInTree(parent, filter, walkable) {
    if (!parent || typeof parent !== "object") return null;
    try { if (filter(parent)) return parent; } catch (e) {}
    if (Array.isArray(parent)) {
      for (let i = 0; i < parent.length; i++) { const r = findInTree(parent[i], filter, walkable); if (r) return r; }
      return null;
    }
    return findInChildren(parent, filter, walkable);
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

  // RouterHook: register full-screen routes and patch existing ones. Under a loader the loader
  // supplies this; as sole host we patch Steam's gamepad router (found via `Settings.Root()`),
  // wrapping it to splice our routes + apply per-path patches. Best-effort (afterPatch swallows).
  function makeRouterHook() {
    const routes = new Map(); // path -> { component, props }
    const routePatches = new Map(); // path -> Set<patch>
    const globalComponents = new Map(); // id -> component (always-rendered, e.g. the home bridge)
    let RouteComp = null;
    let patched = false;
    let wrapperInserted = false; // true once our stateful wrapper is in the live tree
    const OUR_ARRAY = "__shelvesRoutes"; // marks the sub-array we append
    const IS_PATCHED = "__shelvesRoutePatched"; // marks an already-patched route

    // Minimal router-state store: the mounted wrapper components subscribe; a route/patch/global
    // change calls bump() to re-render them CLEANLY via React state — instead of the old fiber-repoint
    // force, which mutated the router fiber out-of-band and left focus unable to register our pages.
    const listeners = new Set();
    function bump() { listeners.forEach(function (l) { try { l(); } catch (e) {} }); }
    function subscribe(l) { listeners.add(l); return function () { listeners["delete"](l); }; }

    /* FALLBACK Route resolution: reuse the type of an existing route in the live
       list. Only used if the source-regex (findRoute) fails on some future client.
       NOTE: this yields Steam's route WRAPPER (e.g. `/library/home` = a services-
       gated wrapper), not the raw Route — so it can carry unwanted context; the raw
       Route from findRoute is preferred. Cached once resolved. */
    // Prefer the `/library/home` route's type; else the first path-carrying route's type.
    function scanRouteList(routeList) {
      let first = null;
      for (let i = 0; i < routeList.length; i++) {
        const el = routeList[i];
        if (el && el.type && el.props && typeof el.props.path === "string") {
          if (!first) first = el.type;
          if (el.props.path === "/library/home") return el.type;
        }
      }
      return first;
    }
    function routeTypeFromList(routeList) {
      if (RouteComp) return RouteComp;
      if (!routeList) return null;
      RouteComp = scanRouteList(routeList);
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

    // Apply the registered patches for ONE route (no-op unless it has a path with patches that
    // haven't been applied to its current children yet).
    function applyPatchesToRoute(route) {
      if (!route || !route.props || !route.props.path) return;
      const set = routePatches.get(route.props.path);
      if (!set || !set.size) return;
      if (route.props.children && route.props.children[IS_PATCHED]) return;
      set.forEach(function (patch) {
        try {
          const res = patch(Object.assign({}, route.props));
          if (res && res.children !== undefined) route.props.children = res.children;
        } catch (e) { log("routePatch:", route.props.path, e && e.message); }
      });
      try { if (route.props.children) route.props.children[IS_PATCHED] = true; } catch (e) {}
    }
    // Apply registered patches to the existing routes in one route-list array.
    function applyPatches(routeList) {
      for (let i = 0; i < routeList.length; i++) applyPatchesToRoute(routeList[i]);
    }

    // Build our route elements ONCE per (route-set, Route-type) and CACHE the array. Steam rebuilds
    // the route-list every render, so rebuilding fresh UNKEYED elements gave React new identities each
    // frame (re-mount → focus loss + sticky routes). A cached KEYED array keeps identities stable.
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

    /* APPEND our routes (the stable cached nested array — React flattens it) at the END of the main
       route-list. Steam's own route elements are UNKEYED, so appending leaves them at their positions
       (React reconciles by position, no remount — prepending would shift all → focus loss). The
       Switch's catch-all (`['/','/index.html','/sp.html']`) is `exact`, so it won't shadow a trailing
       `/deck-shelves/*` route. Our nested array is the SAME cached object with KEYED children. */
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
    function childKind(ch) {
      if (Array.isArray(ch)) return "array(" + ch.length + ")";
      if (ch && ch.props) return "elem";
      if (ch == null) return "none";
      return typeof ch;
    }
    function describeChildren(ch, depth, path) {
      if (Array.isArray(ch)) { for (let j = 0; j < ch.length && j < 12; j++) describe(ch[j], depth + 1, path + ".children[" + j + "]"); }
      else if (ch && ch.props) describe(ch, depth + 1, path + ".children");
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
      log("  [dbg] " + path + " <" + typeName(el.type) + ">" + pth + " children=" + childKind(ch));
      describeChildren(ch, depth, path);
    }
    function routerDebug() { try { return !!window.__SHELVES_ROUTER_DEBUG__; } catch (e) { return false; } }

    // The route-list arrays inside the router output: each top container whose `children` is an array.
    function collectRouteLists(routerOutput) {
      const top = routerOutput.props.children;
      const containers = Array.isArray(top) ? top : [top];
      const lists = [];
      for (let i = 0; i < containers.length; i++) {
        const c = containers[i];
        if (c && c.props && Array.isArray(c.props.children)) lists.push(c.props.children);
      }
      return lists;
    }
    function recordRouterStats(lists) {
      try {
        const st = (window.__SHELVES_ROUTER_STATS__ = window.__SHELVES_ROUTER_STATS__ || { renders: 0 });
        st.renders++; st.lists = lists.length; st.mainLen = lists.length ? lists[0].length : 0;
        st.routeType = RouteComp ? typeName(RouteComp) : null; st.ourRoutes = routes.size; st.builtLen = builtRoutes ? builtRoutes.length : 0;
      } catch (e) {}
    }
    // Inject our routes + patches into the router's output: a Fragment of two containers whose
    // `children` are route-list arrays ([0] = main, [1] = in-game). We patch every list (home
    // shelves live on `/library/home`) and append our routes into the main list.
    function processLists(routerOutput) {
      if (!routerOutput || !routerOutput.props) return;
      if (routerDebug()) { try { window.__DBG_RET__ = routerOutput; } catch (e) {} }
      const lists = collectRouteLists(routerOutput);
      for (let j = 0; j < lists.length; j++) applyPatches(lists[j]);
      if (lists.length) injectRoutes(lists[0]);
      recordRouterStats(lists);
    }

    // The stateful route wrapper: receives the router's output as `children`, injects into its
    // route lists on render, then returns it unchanged — mounted normally (not an out-of-band fiber
    // mutation), so focus registers our pages; subscribes to router state so addRoute re-renders it.
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

    // The route-declaring fiber is the one whose component source mentions `Settings.Root()`.
    function isRouterNode(n) {
      const t = n && (n.elementType || n.type);
      if (!t) return false;
      if (srcOf(t).indexOf("Settings.Root()") >= 0) return true;
      try { if (t.type && srcOf(t.type).indexOf("Settings.Root()") >= 0) return true; } catch (e) {}
      return false;
    }
    // Patch a located router node's memo `.type` (once) and record its fiber. false = unpatchable.
    function patchRouterNode(node) {
      const et = node.elementType || node.type;
      if (!et || typeof et.type !== "function") return false;
      routerFiber = node;
      if (!et.type.__shelvesPatched) { afterPatch(et, "type", handleRender); log("routerHook: router patched."); }
      return true;
    }
    function ensurePatched() {
      if (patched || !React) return patched;
      try {
        const rf = getReactRoot(document.getElementById("root"));
        if (!rf) return false;
        const node = findInReactTree(rf, isRouterNode);
        if (!node) return false;
        if (!patchRouterNode(node)) return false;
        patched = true;
        return true;
      } catch (e) { logWarn("ROUTER", "patch failed: " + (e && e.message)); return false; }
    }

    // ONE-TIME memo-bust: Steam's route-declaring component is memoized and captured its render fn
    // at mount (before our afterPatch), so re-point the live fiber's `type` at the patched fn once,
    // invalidate memo props and forceUpdate the class ancestor. After that our wrapper owns updates.
    let forcePending = false;
    // Re-point the fiber's `type` to the patched inner fn and stamp fresh memoizedProps (on both
    // buffers) so React can't bail out of the memo on the forced re-render.
    function repointRouterFiber() {
      const et = routerFiber.elementType;
      if (et && typeof et.type === "function") {
        routerFiber.type = et.type;
        if (routerFiber.alternate) routerFiber.alternate.type = et.type;
      }
      const stamp = { __shForce: Date.now() };
      routerFiber.memoizedProps = Object.assign({}, stamp, routerFiber.memoizedProps);
      if (routerFiber.alternate) routerFiber.alternate.memoizedProps = Object.assign({}, stamp, routerFiber.alternate.memoizedProps || {});
    }
    // Walk up to the nearest class ancestor and forceUpdate it. true = one was found.
    function forceUpdateAncestor() {
      let p = routerFiber.return, hops = 0;
      while (p && hops++ < 80) {
        if (p.stateNode && typeof p.stateNode.forceUpdate === "function") { p.stateNode.forceUpdate(); return true; }
        p = p.return;
      }
      return false;
    }
    function doForce() {
      forcePending = false;
      if (!routerFiber || wrapperInserted) return;
      try {
        repointRouterFiber();
        if (!forceUpdateAncestor()) log("routerHook: no updatable ancestor to force.");
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
