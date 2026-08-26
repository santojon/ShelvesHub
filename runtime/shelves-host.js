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

  var HOST_API_VERSION = "1.1.0";
  var RPC_ENDPOINT = "http://127.0.0.1:60123";

  if (window.__SHELVES_HOST__ && window.__SHELVES_HOST__.__shelvesRuntime) {
    return window.__SHELVES_HOST__.version;
  }
  function log() {
    var a = [].slice.call(arguments);
    try { console.log.apply(console, ["[shelves-host]"].concat(a)); } catch (e) {}
    // Also buffer to a global so the daemon / devtools can read the runtime's own
    // log via a single eval, without holding a live console stream open (which is
    // hard to capture on-device). Bounded ring; newest last.
    try {
      var b = (window.__SHELVES_LOG__ = window.__SHELVES_LOG__ || []);
      b.push(a.map(function (x) {
        try { return typeof x === "string" ? x : JSON.stringify(x); } catch (e) { return String(x); }
      }).join(" "));
      if (b.length > 300) b.shift();
    } catch (e) {}
  }

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
      } catch (e) { log("webpack capture failed:", e && e.message); }
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
  // Skipped in coexistence (`COEXIST`): this discovery is several full webpack
  // scans (toString over thousands of exports) and it is exactly what blocks the
  // renderer main thread → the active plugin's async shelf resolves time out →
  // React #31 → black screen. These components are only for rendering the
  // bundle, which does NOT run under us while another loader owns the plugin. The
  // QAM tab itself needs only React (and the one QAM module found in installPatch).
  var UI = {};
  if (React && !COEXIST) {
    var CommonUIModule = Steam.findModule(function (m) {
      if (typeof m !== "object") return false;
      for (var prop in m) {
        try { if (m[prop] && m[prop].contextType && m[prop].contextType._currentValue && Object.keys(m).length > 60) return true; } catch (e) {}
      }
      return false;
    });
    var commonValues = CommonUIModule ? Object.values(CommonUIModule) : [];

    var focusableRegex = propListRegex(["flow-children", "onActivate", "onCancel", "focusClassName", "focusWithinClassName"]);
    UI.Focusable = Steam.findModuleExport(function (e) {
      return (typeof e === "function" && focusableRegex.test(srcOf(e))) || focusableRegex.test(renderSrc(e));
    });

    UI.ToggleField = commonValues.find(function (mod) {
      var s = renderSrc(mod);
      return s.indexOf("ToggleField,fallback") >= 0 || s.indexOf('ToggleField",') >= 0;
    });

    var buttonItemRegex = propListRegex(["highlightOnFocus", "childrenContainerWidth"], false);
    UI.ButtonItem = commonValues.find(function (mod) {
      var s = renderSrc(mod);
      return buttonItemRegex.test(s) || s.indexOf('childrenContainerWidth:"min"') >= 0;
    });

    UI.SliderField = commonValues.find(function (mod) {
      var s = srcOf(mod);
      return s.indexOf("SliderField,fallback") >= 0 || s.indexOf('SliderField",') >= 0;
    });

    UI.Field = Steam.findModuleExport(function (e) {
      return (srcOf(e).indexOf("().Field") >= 0 && srcOf(e).indexOf('"shift-children-below"') >= 0) ||
        renderSrc(e).indexOf('"shift-children-below"') >= 0;
    });

    var panelDetails = Steam.findModuleDetailsByExport(function (e) { return srcOf(e).indexOf(".PanelSection") >= 0; });
    UI.PanelSection = panelDetails[1];
    UI.PanelSectionRow = panelDetails[0]
      ? Object.values(panelDetails[0]).filter(function (exp) { return srcOf(exp).indexOf(".PanelSection") < 0; })[0]
      : undefined;
  }

  // A minimal error boundary so a bad panel render shows a fallback instead of
  // crashing the Steam renderer.
  var ErrorBoundary = null;
  if (React && React.Component) {
    ErrorBoundary = class extends React.Component {
      constructor(p) { super(p); this.state = { err: null }; }
      static getDerivedStateFromError(err) { return { err: err }; }
      componentDidCatch(e) { log("panel render error:", e && e.message); }
      render() {
        return this.state.err
          ? h("div", { style: { padding: "16px", color: "#ff8d8d", fontSize: "13px" } },
              I18N.t("panel_error"))
          : this.props.children;
      }
    };
  }

  // ── React tree patch helpers ──────────────────────────────────────────────
  // GenericPatchHandler: (args, ret) => newRet. Wraps obj[prop].
  function afterPatch(obj, prop, handler) {
    var orig = obj[prop];
    var patched = function () {
      var ret = orig.apply(this, arguments);
      try { return handler(arguments, ret); } catch (e) { log("patch handler:", e && e.message); return ret; }
    };
    // Carry the original's own props and reported source forward. Steam matches
    // components by `type.toString()` (webpack filters, render paths); a wrapper
    // that reports its own source — or drops the original's static props —
    // breaks that matching. Object.assign onto a FUNCTION target stays callable
    // (the non-callable trap is only `Object.assign({}, fn)`).
    try { Object.assign(patched, orig); } catch (e) {}
    try { patched.toString = function () { return orig.toString(); }; } catch (e) {}
    patched.__shelvesPatched = true;
    obj[prop] = patched;
    return orig;
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
    if (NATIVE_QAM_ENABLED) {
      var prior = tripGet();
      if (prior === "armed") {
        tripSet("tripped:" + Date.now());
        tripped = true;
        log("QAM native: previous arm never confirmed — TRIPPED. Overlay fallback active; clear localStorage['" + TRIP_KEY + "'] to retry.");
      } else if (prior && prior.indexOf("tripped") === 0) {
        tripped = true;
        log("QAM native: breaker is tripped (" + prior + ") — overlay fallback active; clear localStorage['" + TRIP_KEY + "'] to retry.");
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
    function contentEl(spec) {
      var inner;
      if (typeof spec.render === "function") {
        inner = h(function () {
          var ref = React.useRef(null);
          React.useEffect(function () {
            if (!ref.current) return undefined;
            var cleanup;
            try { cleanup = spec.render(ref.current); } catch (e) { log("qam panel render:", e && e.message); }
            return typeof cleanup === "function" ? cleanup : undefined;
          }, []);
          return h("div", { ref: ref, style: { width: "100%", height: "100%" } });
        }, null);
      } else {
        inner = typeof spec.content === "function" ? spec.content() : spec.content;
      }
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
      back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
      hub: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    };
    function fbIcon(name) {
      return h("span", {
        key: "i",
        style: { display: "inline-flex", flex: "0 0 16px", width: "16px", height: "16px", opacity: 0.9 },
        dangerouslySetInnerHTML: { __html: FALLBACK_ICONS[name] },
      });
    }
    function FallbackPanel(props) {
      var onBack = props && props.onBack;
      var st = React.useState(null);
      var busy = st[0], setBusy = st[1];
      // null = still loading the setting; then a boolean mirrors the store.
      var au = React.useState(null);
      var autoUpdate = au[0], setAutoUpdate = au[1];
      React.useEffect(function () {
        var alive = true;
        hostRpc("getConfig").then(function (r) {
          if (!alive) return;
          var v = r && r.ok && r.result && typeof r.result.auto_update === "boolean" ? r.result.auto_update : false;
          setAutoUpdate(v);
        }, function () { if (alive) setAutoUpdate(false); });
        return function () { alive = false; };
      }, []);
      function run(id, method) {
        setBusy(id);
        hostRpc(method).then(function () { setBusy(null); }, function () { setBusy(null); });
      }
      function toggleAuto() {
        if (busy) return;
        var next = !(autoUpdate === true);
        setAutoUpdate(next); setBusy("auto");
        hostRpc("setAutoUpdate", next).then(function (r) {
          setBusy(null);
          if (r && r.ok && r.result && typeof r.result.auto_update === "boolean") setAutoUpdate(r.result.auto_update);
        }, function () { setBusy(null); setAutoUpdate(!next); });
      }
      var row = {
        display: "flex", alignItems: "center", gap: "10px",
        width: "100%", boxSizing: "border-box", padding: "10px 14px",
        marginTop: "8px", textAlign: "left", border: "none",
        borderRadius: "4px", fontSize: "14px", color: "#fff",
      };
      function actionBtn(id, icon, key, method, primary) {
        return h("button", {
          key: id,
          onClick: function () { if (!busy) run(id, method); },
          "data-fb": id,
          style: Object.assign({}, row, {
            cursor: busy ? "default" : "pointer",
            opacity: busy && busy !== id ? 0.5 : 1,
            background: primary ? "#1a9fff" : "rgba(255,255,255,0.08)",
          }),
        }, fbIcon(icon), h("span", { key: "t", style: { flex: "1 1 auto" } }, I18N.t(key)));
      }
      function toggleRow() {
        var on = autoUpdate === true;
        return h("div", {
          key: "auto", onClick: toggleAuto, "data-fb": "auto", "data-on": on ? "1" : "0",
          style: Object.assign({}, row, { cursor: busy ? "default" : "pointer", background: "rgba(255,255,255,0.08)" }),
        },
          fbIcon("auto"),
          h("span", { key: "t", style: { flex: "1 1 auto" } }, I18N.t("action_auto_update")),
          h("span", {
            key: "sw",
            style: { flex: "0 0 auto", width: "38px", height: "22px", borderRadius: "11px", position: "relative", background: on ? "#1a9fff" : "rgba(255,255,255,0.25)" },
          }, h("span", { style: { position: "absolute", top: "2px", left: on ? "18px" : "2px", width: "18px", height: "18px", borderRadius: "50%", background: "#fff" } }))
        );
      }
      var titleRow = onBack
        ? h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
            h("button", {
              onClick: onBack, "data-fb": "back", title: I18N.t("action_back"),
              style: { flex: "0 0 auto", width: "28px", height: "28px", border: "none", borderRadius: "4px", background: "rgba(255,255,255,0.08)", color: "#fff", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" },
            }, fbIcon("back")),
            h("div", { style: { fontSize: "18px", fontWeight: "700" } }, I18N.t("hub_title")))
        : h("div", { style: { fontSize: "18px", fontWeight: "700" } }, I18N.t("hub_title"));
      return h(
        "div",
        { style: { padding: "16px 15px 10px" }, "data-fb-panel": "1" },
        titleRow,
        h("div", { style: { fontSize: "13px", opacity: 0.7, margin: "4px 0 12px" } }, I18N.t(onBack ? "hub_subtitle" : "unavailable_body")),
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
      function wrap(node) { return ErrorBoundary ? h(ErrorBoundary, null, node) : node; }
      // No registered panel → the hub view IS the content (the fallback).
      if (!s) return wrap(h(FallbackPanel, null));
      // Hub view opened from the plugin editor → show it with a back button.
      if (showHub) return wrap(h(FallbackPanel, { onBack: function () { setShowHub(false); } }));
      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", height: "100%" } },
        h("div", { style: { flex: "1 1 auto", minHeight: 0, overflow: "auto" } }, contentEl(s)),
        h("button", {
          onClick: function () { setShowHub(true); },
          "data-fb": "open-hub",
          style: {
            flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center",
            gap: "8px", width: "100%", boxSizing: "border-box", padding: "10px 14px",
            border: "none", borderTop: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.05)", color: "#fff", cursor: "pointer", fontSize: "13px",
          },
        }, fbIcon("hub"), h("span", { key: "t" }, I18N.t("hub_title")))
      );
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
      } catch (err) { log("QAM registerTabEnum error:", err && err.message); }
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
      var tab = buildTab();
      // Position: right after Steam's Performance tab, so we sit ahead of any
      // tab that is appended at the end of the list (later additions land last).
      var after = insertAfterKey(), at = tabs.length;
      if (after != null) {
        for (var i = 0; i < tabs.length; i++) { if (tabs[i] && tabs[i].key === after) { at = i + 1; break; } }
      }
      tabs.splice(at, 0, tab); // insert in place (array mutable; element props may be frozen)
      if (!confirmed) { confirmed = true; tripClear(); log("QAM native: tab inserted, healthy."); }
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
        // Arm the breaker: if this session never confirms a healthy patched
        // render, the next boot trips and forces standing down.
        tripSet("armed");
        var handler = function (args, ret) {
          try {
            if (args && args[0] && typeof args[0].visible !== "undefined") lastVisible = args[0].visible;
            injectTabs(ret);
          } catch (e) { log("QAM append error (ignored):", e && e.message); }
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
        // This re-point synchronously mutates a LIVE fiber. In OWNER mode a
        // late/arbitrary-timed inject tears the Steam UI down (confirmed on-device
        // — the immediate black screen), so it stays opt-in there. In COEXISTENCE
        // the patch is tab-only (no host, no heavy owner-mode scan) and the
        // re-point is SAFE — verified on-device (no UI collapse) and in the
        // scenario harness — so enable it by default there, letting an
        // already-mounted menu show our tab without waiting for a remount (the
        // late-daemon-injection case). Force with `window.__SHELVES_FIBER_REPOINT__`.
        var doRepoint = COEXIST;
        try { if (window.__SHELVES_FIBER_REPOINT__ === true) doRepoint = true; } catch (e) {}
        if (doRepoint) { patchMountedConsumer(bv, embedded); }
        else { log("QAM native: mounted re-point OFF (owner mode; opt in via __SHELVES_FIBER_REPOINT__)."); }
      } catch (e) {
        tripClear();
        log("QAM installPatch failed:", e && e.message);
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
    routes: {
      register: function (path, component) { log("routes.register", path); return { dispose: function () { log("routes.remove", path); } }; },
      addRoute: function (p) { log("routes.addRoute", p); },
      removeRoute: function (p) { log("routes.removeRoute", p); },
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

  // (A) Host API — installed only when we are NOT coexisting with another
  // loader. In coexistence we leave `__SHELVES_HOST__` unset so the other
  // loader's Deck Shelves keeps selecting its own adapter (safety invariant).
  // (B) — the QAM tab — already ran above via QamHost, regardless of coexistence.
  if (!COEXIST) {
    window.__SHELVES_HOST__ = host;
    try { window.__DECK_SHELVES_OWNER__ = "shelveshub"; } catch (e) {}
  } else {
    try { if (!window.__DECK_SHELVES_OWNER__) window.__DECK_SHELVES_OWNER__ = "decky"; } catch (e) {}
  }
  log("runtime ready v" + HOST_API_VERSION + (Steam.isSteam() ? " (Steam)" : " (no webpack)") +
    " ui[" + Object.keys(UI).filter(function (k) { return !!UI[k]; }).join(",") + "]" +
    " qam=" + QamHost.mode() + (COEXIST ? " coexist(tab-only)" : " owner"));
  return COEXIST ? undefined : HOST_API_VERSION;
})();
