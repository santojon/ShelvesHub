// runtime/shelves-host.js
//
// The Shelves Loader host runtime. Injected by the loader into the Steam UI
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

  // ── Steam webpack: module cache + finders ─────────────────────────────────
  var Steam = (function () {
    var modules = new Map(); // id -> module
    var inited = false;

    function init() {
      if (inited) return;
      inited = true;
      var req = null;
      try {
        var key = Object.keys(window).filter(function (k) {
          return k.indexOf("webpackChunk") === 0 && Array.isArray(window[k]);
        })[0];
        if (!key) return;
        window[key].push([[Symbol("shelves-loader")], {}, function (r) { req = r; }]);
      } catch (e) { log("webpack capture failed:", e && e.message); }
      if (!req || !req.m) return;
      Object.keys(req.m).forEach(function (id) {
        try { var m = req(id); if (m) modules.set(id, m); } catch (e) {}
      });
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
  // Faithful port of the proven QAM tab-injection: patch both QAM renderers'
  // `.type` with a tree patcher that navigates to the tab-list node and injects
  // our tab(s) into `props.tabs`, then refresh the already-mounted QAM fiber.
  var QamHost = (function () {
    var KEY_PREFIX = "shelves-";
    // Native QAM tab is WIP and must be validated on a non-primary device — it
    // can destabilise the Steam renderer. Off by default so the deployed state
    // is stable. Flip to true to test the native tab.
    var NATIVE_QAM_ENABLED = false;
    var PATCH_EMBEDDED = false; // patching the in-main-tree Embedded QAM risks a black screen
    var specs = {};
    var browserView = null, embedded = null;
    var patched = false;

    function iconEl(icon) {
      if (icon && icon.$$typeof) return icon;
      if (typeof icon === "string") return h("div", { style: { display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }, dangerouslySetInnerHTML: { __html: icon } });
      return null;
    }
    function contentEl(spec) {
      var c = typeof spec.content === "function" ? spec.content() : spec.content;
      return ErrorBoundary ? h(ErrorBoundary, null, c) : c;
    }

    // Inject our tab(s) into the live tabs array, idempotently per render.
    function renderTabs(tabs, visible) {
      Object.keys(specs).forEach(function (id) {
        var key = KEY_PREFIX + id;
        var existing = null;
        for (var i = 0; i < tabs.length; i++) { if (tabs[i] && tabs[i].key === key) { existing = tabs[i]; break; } }
        if (existing) { existing.initialVisibility = visible; return; }
        var spec = specs[id];
        tabs.push({
          key: key, title: spec.title, strTitle: spec.title,
          tab: iconEl(spec.icon), panel: contentEl(spec),
          shelves: true, initialVisibility: visible !== false,
        });
      });
    }

    function makePatchHandler() {
      return createReactTreePatcher(
        [function (tree) { return findInReactTree(tree, function (n) { return n && n.props && n.props.onFocusNavDeactivated; }); }],
        function (args, ret) {
          var node = findInReactTree(ret, function (x) { return x && x.props && Array.isArray(x.props.tabs); });
          if (node) renderTabs(node.props.tabs, args[0] && args[0].visible);
          return ret;
        }
      );
    }

    function installPatch() {
      if (patched || !React) return patched;
      var mod = Steam.findModuleByExport(function (e) {
        try { return e && e.type && typeof e.type === "function" && e.type.toString().indexOf("QuickAccessMenuBrowserView") >= 0; } catch (_) { return false; }
      });
      if (!mod) return false;
      var vals = Object.values(mod);
      browserView = vals.find(function (e) { try { return e && e.type && e.type.toString && e.type.toString().indexOf("QuickAccessMenuBrowserView") >= 0; } catch (_) { return false; } });
      embedded = vals.find(function (e) { try { return e && e.type && e.type.toString && e.type.toString().indexOf("QuickAccessMenuEmbedded") >= 0; } catch (_) { return false; } });
      var handler = makePatchHandler();
      // Patch ONLY the BrowserView (the separate QAM popup). The Embedded
      // renderer lives in the main UI tree, so patching it risks blacking out
      // the whole screen — opt-in only.
      if (browserView && !browserView.type.__shelvesPatched) afterPatch(browserView, "type", handler);
      if (PATCH_EMBEDDED && embedded && !embedded.type.__shelvesPatched) afterPatch(embedded, "type", handler);
      patched = !!browserView;
      if (patched) log("QAM patched (browserView=" + !!browserView + " embedded=" + (PATCH_EMBEDDED && !!embedded) + ")");
      return patched;
    }

    // Refresh the single already-mounted QAM fiber so it re-renders through the
    // patch (its fiber holds the pre-patch type; new mounts use the patch).
    function refreshLiveQam() {
      try {
        var root = getReactRoot(document.getElementById("root")) || getReactRoot(document.body);
        if (!root) return;
        var qamNode = findInReactTree(root, function (n) {
          return n && n.elementType && (n.elementType === browserView || (PATCH_EMBEDDED && embedded && n.elementType === embedded));
        });
        if (qamNode) {
          qamNode.type = qamNode.elementType.type;
          if (qamNode.alternate) qamNode.alternate.type = qamNode.type;
        }
      } catch (e) { log("refreshLiveQam:", e && e.message); }
    }

    function registerPanel(spec) {
      if (!spec || typeof spec.id !== "string") throw new Error("[shelves-host] qam.registerPanel: { id, title, icon, content } required");
      specs[spec.id] = spec;
      if (NATIVE_QAM_ENABLED) { installPatch(); refreshLiveQam(); }
      log("QAM panel registered:", spec.id, NATIVE_QAM_ENABLED ? (patched ? "(native)" : "(patch unavailable)") : "(native disabled)");
      return function () { delete specs[spec.id]; if (NATIVE_QAM_ENABLED) refreshLiveQam(); };
    }
    return { registerPanel: registerPanel, _specs: specs, _isNative: function () { return patched; } };
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

  window.__SHELVES_HOST__ = host;
  log("runtime ready v" + HOST_API_VERSION + (Steam.isSteam() ? " (Steam)" : " (no webpack)") +
    " ui[" + Object.keys(UI).filter(function (k) { return !!UI[k]; }).join(",") + "]");
  return HOST_API_VERSION;
})();
