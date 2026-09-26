// runtime/shelves-host-api.js — HostApi assembly + late-boot wiring. Assembled
// after shelves-host.js and shelves-host-qam.js into ONE injected IIFE (shared
// closure; see shelves-host.js); not a standalone module.


  // ── HostApi assembly ──────────────────────────────────────────────────────
  const mountHandlers = [], unmountHandlers = [];
  const host = {
    __shelvesRuntime: true,
    version: HOST_API_VERSION,
    // Identify this host + the capabilities it implements, so a bundle can adapt
    // without feature-detecting each member (contract `HostHandshake`).
    handshake: function () {
      return {
        hostKind: "shelveshub",
        hostVersion: SHELVES_CFG.hostVersion || HOST_API_VERSION,
        hostApiVersion: HOST_API_VERSION,
        capabilities: {
          teardown: true,
          selfUpdate: !COEXIST || COOP,
          nativeQam: nativeUiOn(),
          coexist: !!COEXIST,
        },
      };
    },
    // Steam's React stack, discovered from webpack in owner mode — the bundle's
    // react / react-dom / jsx-runtime shims read these from `__SHELVES_HOST__`
    // (no loader-shaped globals are published; the host stays neutral).
    React: React,
    ReactDOM: ReactStack.ReactDOM,
    jsx: ReactStack.jsx,
    ui: UI,
    ErrorBoundary: ErrorBoundary,
    /* Shapes conform to the @deck-shelves/host contract directly (so the
       plugin's resolveHost() uses this object as the HostApi with no interim
       adapter). The legacy shapes (register() no-arg, addRoute/removeRoute,
       notifications.send) are kept for older bundles that still bridge. */
    lifecycle: {
      register: function (plugin) { log("lifecycle.register", plugin && plugin.name); return { dispose: function () {} }; },
      onMount: function (cb) { if (typeof cb === "function") { mountHandlers.push(cb); cb(); } },
      onUnmount: function (cb) { if (typeof cb === "function") unmountHandlers.push(cb); },
      // Dispose the CURRENT bundle instance before a hot-swap re-evals a new one,
      // so two instances don't both own the Home. Runs the bundle's onUnmount
      // handlers once; the loader calls this (via __SHELVES_TEARDOWN__) first.
      teardown: function () {
        const hs = unmountHandlers.splice(0, unmountHandlers.length);
        for (let i = 0; i < hs.length; i++) {
          try { hs[i](); } catch (e) { log("lifecycle.teardown handler:", e && e.message); }
        }
        return hs.length;
      },
    },
    rpc: {
      call: function (method, args) {
        return fetch(RPC_ENDPOINT, { method: "POST", headers: rpcHeaders(), body: JSON.stringify({ method: method, args: args == null ? null : args }) })
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
    /* Self-install of a PLUGIN update: the daemon obtains the release asset and swaps
       the injected bundle, so the plugin's update UX can offer "Install" (not just
       "Download"). applyUpdate reloads once the swap succeeds, so the daemon re-injects
       the new bundle and the plugin re-boots on it. */
    updates: {
      // True only when THIS host owns the bundle (sole, or coop/forced) — then the
      // hub manages plugin updates and the plugin can hide its own update banner.
      // In plain coexistence the loader owns updates, so the plugin keeps it.
      canSelfInstall: function () { return !COEXIST || COOP; },
      applyUpdate: function (release) {
        return fetch(RPC_ENDPOINT, { method: "POST", headers: rpcHeaders(), body: JSON.stringify({ method: "applyUpdate", args: release == null ? null : release }) })
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
  /* Drain panels a Deck Shelves registered before this bridge existed: when it
     boots first (under another loader) it leaves them on `__SHELVES_QAM_PENDING__`.
     Registering against `__SHELVES_QAM__` (the idempotent bridge) guarantees they
     feed the tab that is actually live, whichever runtime patched it. */
  try {
    const pend = window.__SHELVES_QAM_PENDING__, q = window.__SHELVES_QAM__;
    if (q && pend && pend.length) { for (let pi = 0; pi < pend.length; pi++) { try { q.registerPanel(pend[pi]); } catch (e) {} } pend.length = 0; }
  } catch (e) {}

  /* Build the loader-style class map: the array of Steam CSS-class modules (each
     an object whose values are all obfuscated class-name strings). The plugin reads
     this off the loader global for stable native-class discovery; without a loader
     it falls back to fragile DOM probing. Mirrors the loader's own filter. */
  function buildClassMap() {
    const out = [];
    try {
      const it = Steam.modules.values();
      for (let n = it.next(); !n.done; n = it.next()) {
        const m = n.value;
        if (!m || typeof m !== "object" || m.__esModule) continue;
        const keys = Object.keys(m);
        if (keys.length === 0 || keys.length >= 1000) continue;
        if (keys.length === 1 && m.version) continue; // a version-only module
        if (m.AboutSettings) continue; // the localization module
        let allStrings = true;
        for (let i = 0; i < keys.length; i++) {
          const d = Object.getOwnPropertyDescriptor(m, keys[i]);
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
      for (let i = 0; i < requiredKeys.length; i++) {
        if (typeof m[requiredKeys[i]] !== "string") return false;
      }
      return true;
    });
  }

  /* React's internal hook dispatcher — needed to stub hooks for fakeRenderComponent
     (renders a function component off-tree to read its output, so the plugin's menu
     discovery can locate the class/type to patch). Handles the React 18 secret-
     internals shape and the React 19 one. */
  function internalHooks() {
    try {
      const d = React && React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
      if (d && d.ReactCurrentDispatcher && d.ReactCurrentDispatcher.current) return d.ReactCurrentDispatcher.current;
    } catch (e) {}
    try {
      const ci = React && React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      if (ci) { for (const k in ci) { const p = ci[k]; if (p && p.useEffect) return p; } }
    } catch (e) {}
    return null;
  }
  let _savedHooks = null;
  function applyHookStubs(customHooks) {
    const h = internalHooks();
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
    h.useState = function (v) { let val = v; return [val, function (n) { val = n; }]; };
    if (customHooks) { for (const ck in customHooks) h[ck] = customHooks[ck]; }
    return h;
  }
  function removeHookStubs() {
    const h = internalHooks();
    if (h && _savedHooks) { for (const k in _savedHooks) h[k] = _savedHooks[k]; }
    _savedHooks = null;
  }
  // Restore the dispatcher even if the component throws mid-render — a leaked
  // stub would corrupt the NEXT real render (this runs from an event handler, so
  // no React render is interleaved, but the finally keeps a throw from leaking).
  function fakeRenderComponent(fun, customHooks) {
    const h = applyHookStubs(customHooks);
    try { return fun(h); }
    catch (e) { return null; }
    finally { removeHookStubs(); }
  }
  // Loader-style findModuleChild: first truthy result of `filter` over each
  // module (and its `.default`).
  function findModuleChild(filter) {
    const it = Steam.modules.values();
    for (let n = it.next(); !n.done; n = it.next()) {
      const m = n.value, variants = [m && m.default, m];
      for (let i = 0; i < variants.length; i++) {
        try { const r = filter(variants[i]); if (r) return r; } catch (e) {}
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
    const tasks = [
      function () {
        UI.MenuSeparator = Steam.findModuleExport(function (e) {
          return typeof e === "function" && /className:.+?\.ContextMenuSeparator/.test(srcOf(e));
        });
      },
      function () {
        const groupMod = Steam.findModuleByExport(function (e) {
          try {
            if (!(e && e.prototype && e.prototype.Focus && e.prototype.OnOKButton && e.prototype.render)) return false;
            /* Match the tone/emphasis check regardless of operand order or
               operator spelling — the minifier reorders it across client
               versions (stable: "emphasis"==this.props.tone; beta:
               this.props.tone=="emphasis"), so an exact-string test is fragile. */
            const rs = srcOf(e.prototype.render);
            return rs.indexOf("emphasis") >= 0 && rs.indexOf("props.tone") >= 0;
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
    let i = 0;
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
    const ctrl = window.FocusNavController;
    if (!ctrl) return null;
    const ctx = ctrl.m_ActiveContext || ctrl.m_LastActiveContext;
    if (!ctx || !ctx.m_rgGamepadNavigationTrees) return null;
    const trees = ctx.m_rgGamepadNavigationTrees;
    const arr = Array.isArray(trees) ? trees : (trees.values ? Array.from(trees.values()) : []);
    for (let i = 0; i < arr.length; i++) {
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
  const _prunedNodes = [];
  function pruneHiddenNavNodes() {
    try {
      const root = mainNavRoot();
      if (!root) return;
      const zeroSize = function (el) {
        if (!el || !el.getBoundingClientRect) return false;
        const r = el.getBoundingClientRect();
        return r.width === 0 && r.height === 0;
      };
      const ours = function (el) {
        try {
          const m = el.ownerDocument && el.ownerDocument.getElementById("deck-shelves-home-root");
          return !!(m && m.contains(el));
        } catch (e) { return false; }
      };
      let touched = false;
      // Restore pass: any node we removed whose element is now VISIBLE again goes
      // back into its parent (nav order is fixed by clearing m_bChildrenSorted, so
      // Steam re-sorts by DOM position). Drop records whose element has detached.
      for (let k = _prunedNodes.length - 1; k >= 0; k--) {
        const rec = _prunedNodes[k];
        const el = rec.node && rec.node.m_element;
        const attached = !!(el && el.ownerDocument && el.ownerDocument.contains(el));
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
        const kids = node.m_rgChildren;
        for (let j = kids.length - 1; j >= 0; j--) {
          const c = kids[j];
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
  let _navPruneTimer = null;
  function startNavPrune() {
    if (_navPruneTimer) return;
    _navPruneTimer = setInterval(pruneHiddenNavNodes, 500);
  }

  /* (A) Host API — installed only when we are NOT coexisting with another
     loader. In coexistence we leave `__SHELVES_HOST__` unset so the other
     loader's Deck Shelves keeps selecting its own adapter (safety invariant).
     (B) — the QAM tab — already ran above via QamHost, regardless of coexistence. */
  if (!COEXIST || COOP) {
    // Cooperative ownership borrows the loader's router hook so the host's routes
    // resolve without a scan (the loader owns the renderer; our host renders in it).
    if (COOP) {
      try { const _dfl = window.DFL || window.deckyFrontendLib; if (_dfl && _dfl.routerHook) host.routerHook = _dfl.routerHook; } catch (e) {}
    }
    window.__SHELVES_HOST__ = host;
    // Sole mode claims ownership outright. Cooperation only fills it in if unset,
    // so a plugin instance that already claimed (either kind) is never clobbered.
    try {
      if (!COOP) { window.__DECK_SHELVES_OWNER__ = "shelveshub"; }
      else if (!window.__DECK_SHELVES_OWNER__) { window.__DECK_SHELVES_OWNER__ = "shelveshub"; }
    } catch (e) {}
    // Nav pruning is an owner-mode (sole) behaviour; in cooperation the loader owns
    // the renderer and its navigation, so we never touch it.
    if (!COOP) startNavPrune();
    // NOTE: host.ui is augmented with loader-equivalent helpers from the UI-scan's
    // onDone (before signalUiReady), so it's complete when the bundle's shim binds
    // to `__SHELVES_HOST__.ui` — see the ensureUiChunked call near the UI section.
  } else {
    try { if (!window.__DECK_SHELVES_OWNER__) window.__DECK_SHELVES_OWNER__ = "decky"; } catch (e) {}
  }
  log("runtime ready v" + HOST_API_VERSION + (Steam.isSteam() ? " (Steam)" : " (no webpack)") +
    " ui[" + Object.keys(UI).filter(function (k) { return !!UI[k]; }).join(",") + "]" +
    " qam=" + QamHost.mode() + (COEXIST ? " coexist(tab-only)" : " owner"));
