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
    try { console.log.apply(console, ["[shelves-host]"].concat([].slice.call(arguments))); } catch (e) {}
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
  var COEXIST = otherLoaderPresent() && !FORCE_OWNER; // tab yes, host no
  if (COEXIST) {
    log("Another plugin loader detected — coexistence mode: adding OUR tab only, NOT taking over the host (its Deck Shelves is left untouched).");
  }

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
      if (!req || !req.m) return;
      var ids = Object.keys(req.m);
      for (var i = 0; i < ids.length; i++) {
        if (modules.has(ids[i])) continue;
        try { var m = req(ids[i]); if (m) modules.set(ids[i], m); } catch (e) {}
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
    function getReact() { return (window.SP_REACT && window.SP_REACT.createElement) ? window.SP_REACT : null; }

    return {
      get modules() { init(); return modules; },
      findModule: findModule,
      findModuleDetailsByExport: findModuleDetailsByExport,
      findModuleExport: findModuleExport,
      findModuleByExport: findModuleByExport,
      isSteam: isSteam, getReact: getReact, init: init,
    };
  })();

  var React = Steam.getReact();
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
  var UI = {};
  if (React) {
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
              "Deck Shelves: erro ao renderizar o painel.")
          : this.props.children;
      }
    };
  }

  // ── React tree patch helpers ──────────────────────────────────────────────
  // GenericPatchHandler: (args, ret) => newRet. Wraps obj[prop].
  function afterPatch(obj, prop, handler) {
    var orig = obj[prop];
    obj[prop] = function () {
      var ret = orig.apply(this, arguments);
      try { return handler(arguments, ret); } catch (e) { log("patch handler:", e && e.message); return ret; }
    };
    obj[prop].__shelvesPatched = true;
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
    var k = Object.keys(el).find(function (x) { return x.indexOf("__reactContainer$") === 0; });
    if (k) return el[k];
    if (el._reactRootContainer && el._reactRootContainer._internalRoot) return el._reactRootContainer._internalRoot.current;
    return null;
  }

  // Clone a component's type/render so a patch is localized to this node and
  // never mutates the shared component used elsewhere in the UI.
  function wrapReactType(node, prop) {
    prop = prop || "type";
    if (node[prop] && node[prop].__shelvesWrapped) return node[prop];
    // Object.assign copies own enumerable string AND symbol keys, so the React
    // `$$typeof` Symbol (memo/forward_ref marker) survives — a for-in/manual
    // copy would drop it and produce an invalid component.
    var copy = Object.assign({}, node[prop]);
    copy.__shelvesWrapped = true;
    return (node[prop] = copy);
  }
  function wrapReactClass(node, prop) {
    prop = prop || "type";
    if (node[prop] && node[prop].__shelvesWrapped) return node[prop];
    var cls = node[prop];
    var wrapped = class extends cls {};
    wrapped.__shelvesWrapped = true;
    return (node[prop] = wrapped);
  }

  // ── createReactTreePatcher: step-based, cached, clone-localized patcher ────
  function patchComponent(node, handler, steps, step, caches, prop) {
    prop = prop || "type";
    var next = steps[step + 1] ? createStepHandler(handler, steps, step + 1, caches) : handler;
    var t = node[prop];
    if (typeof t === "function") {
      afterPatch(node, prop, next);
    } else if (t && typeof t === "object") {
      if (t.prototype && t.prototype.render) {
        wrapReactClass(node, prop);
        afterPatch(node[prop].prototype, "render", next);
      } else {
        wrapReactType(node, prop);
        patchComponent(node[prop], handler, steps, step, caches, node[prop].render ? "render" : "type");
      }
    }
  }
  function handleStep(tree, handler, steps, step, caches) {
    var stepFn = steps[step];
    var cache = caches[step] || (caches[step] = new Map());
    var node = stepFn(tree);
    if (!node || !node.type) return tree;
    var cached = cache.get(node.type);
    if (cached) { node.type = cached; return tree; }
    var originalType = node.type;
    patchComponent(node, handler, steps, step, caches);
    cache.set(originalType, node.type);
    return tree;
  }
  function createStepHandler(handler, steps, step, caches) {
    return function (_args, tree) { return handleStep(tree, handler, steps, step, caches); };
  }
  function createReactTreePatcher(steps, handler) {
    return createStepHandler(handler, steps, 0, []);
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
    function contentEl(spec) {
      var c = typeof spec.content === "function" ? spec.content() : spec.content;
      return ErrorBoundary ? h(ErrorBoundary, null, c) : c;
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
    // Placeholder mark until the Deck Shelves package ships its own icon
    // (the registered spec's icon replaces it the moment the bundle loads).
    var DEFAULT_ICON =
      '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">' +
      '<path d="M3 4h18v3H3zM3 10.5h18v3H3zM3 17h18v3H3z"/></svg>';
    function TabIconSlot() {
      useSlotRefresh();
      var s = firstSpec();
      return iconEl((s && s.icon) || DEFAULT_ICON);
    }
    function PanelSlot() {
      useSlotRefresh();
      var s = firstSpec();
      if (!s) return h("div", { style: { padding: "16px" } }, "Deck Shelves");
      return contentEl(s);
    }
    // A registered tab needs its key present in Steam's `QuickAccessTab` enum:
    // `pt` derives the panel class as `tab_${QuickAccessTab[key]}` and the tab
    // strip's focus/visibility logic keys off the same enum. An unregistered
    // (string) key renders as `tab_undefined` and is not treated as a
    // first-class tab (focus of hidden tabs misbehaves). So we register a
    // numeric key, exactly as other hosts do (their tab sits at 999).
    var NATIVE_TAB_KEY = 998;
    var NATIVE_TAB_NAME = "ShelvesHub";
    function tabEnum() {
      try { if (window.DFL && window.DFL.QuickAccessTab) return window.DFL.QuickAccessTab; } catch (e) {}
      return Steam.findModuleExport(function (m) {
        try { return m && m.Notifications === 0 && m.Settings === 4 && m.Help === 6; } catch (e) { return false; }
      });
    }
    function registerTabEnum() {
      try {
        var e = tabEnum();
        if (e && e[NATIVE_TAB_KEY] === undefined) {
          e[NATIVE_TAB_KEY] = NATIVE_TAB_NAME;
          e[NATIVE_TAB_NAME] = NATIVE_TAB_KEY;
        }
      } catch (_) {}
    }

    function buildTab() {
      return {
        key: NATIVE_TAB_KEY,
        strTitle: "Deck Shelves",
        title: h(React.Fragment, null),
        tab: h(TabIconSlot, null),
        panel: h(PanelSlot, null),
        vrLocation: "quick-access-menu",
      };
    }

    // Position: sit right AFTER Steam's Performance tab, so we are always just
    // below Performance and above any lower tab (other hosts' tabs included,
    // which append at the end). Configurable: set `window.__SHELVES_QAM_AFTER__`
    // to another QuickAccessTab key, or to null to append at the very end.
    var NATIVE_TAB_AFTER = 5; // QuickAccessTab.Perf ("Desempenho")
    function insertAfterKey() {
      try { if ("__SHELVES_QAM_AFTER__" in window) return window.__SHELVES_QAM_AFTER__; } catch (e) {}
      return NATIVE_TAB_AFTER;
    }
    function pushTab(tabs) {
      var tab = buildTab();
      for (var j = 0; j < tabs.length; j++) { if (tabs[j] && tabs[j].key === tab.key) return; }
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
      w.__shelvesTabWrap = true;
      return w;
    }
    function injectTabs(ret) {
      // Fast path: tabs already in this output.
      var direct = findInReactTree(ret, function (x) { return x && x.props && Array.isArray(x.props.tabs); });
      if (direct) { pushTab(direct.props.tabs); return; }
      // Otherwise wrap the component whose output produces the tab list.
      var host = findInReactTree(ret, function (n) { return n && n.props && n.props.onFocusNavDeactivated && n.type; });
      if (!host) return;
      var orig = host.type;
      if (orig.__shelvesTabWrap || (orig.type && orig.type.__shelvesTabWrap)) return; // already wrapped
      if (wrapCache && wrapCache.has(orig)) { host.type = wrapCache.get(orig); return; }
      var wrapped;
      if (typeof orig === "function") {
        wrapped = tabWrapper(orig);
      } else if (orig && typeof orig.type === "function" && orig.$$typeof) {
        // React.memo/forwardRef: keep the wrapper a valid memo with a function type.
        wrapped = { $$typeof: orig.$$typeof, type: tabWrapper(orig.type), compare: orig.compare };
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
        if (!mod) return false; // BrowserView chunk not loaded yet — retry
        var bv = Object.values(mod).find(function (e) {
          try { return e && e.type && e.type.toString && e.type.toString().indexOf("QuickAccessMenuBrowserView") >= 0; } catch (_) { return false; }
        });
        if (!bv || typeof bv.type !== "function") return false;
        if (bv.type.__shelvesPatched) { patched = true; return true; }
        // Register our key so the tab is first-class (class + focus/visibility).
        registerTabEnum();
        // Arm the breaker: if this session never confirms a healthy patched
        // render, the next boot trips and forces the overlay fallback.
        tripSet("armed");
        afterPatch(bv, "type", function (args, ret) {
          try { injectTabs(ret); } catch (e) { log("QAM append error (ignored):", e && e.message); }
          return ret;
        });
        patched = true;
        log("QAM native: BrowserView consumer patched.");
      } catch (e) {
        tripClear();
        log("QAM installPatch failed (overlay fallback):", e && e.message);
      }
      return patched;
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
    React: React,
    ui: UI,
    ErrorBoundary: ErrorBoundary,
    lifecycle: {
      register: function () { log("lifecycle.register"); },
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
    routes: { addRoute: function (p) { log("routes.addRoute", p); }, removeRoute: function (p) { log("routes.removeRoute", p); } },
    notifications: {
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
