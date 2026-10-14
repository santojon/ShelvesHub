// runtime/shelves-host-api.js — HostApi assembly + late-boot wiring. Assembled
// after shelves-host.js and shelves-host-qam.js into ONE injected IIFE (shared
// closure; see shelves-host.js); not a standalone module.


  /* Notification logos, one per sender, in the same visual language (coloured books on a
     shelf, dark 2px outline, Steam blues): the Deck Shelves mark mirrors the plugin's own
     icon (what its toasts carry under a loader); the ShelvesHub mark sets three books over a
     hub node. Both fill whatever box the toast gives them. */
  const SVG_HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%" aria-hidden="true">';
  const PLUGIN_LOGO_SVG = SVG_HEAD +
    '<g transform="translate(-340.6,-224.7) scale(0.76)" stroke="#000" stroke-width="2" stroke-linejoin="round">' +
    '<rect x="550" y="460" width="80" height="285" rx="8" ry="8" fill="#0080FF"/><rect x="551" y="500" width="79" height="25" fill="#0044B0" stroke="none"/>' +
    '<rect x="645" y="500" width="75" height="245" rx="8" ry="8" fill="#0080FF"/><rect x="646" y="535" width="73" height="25" fill="#0044B0" stroke="none"/>' +
    '<rect x="740" y="530" width="75" height="215" rx="8" ry="8" fill="#FFFFFF"/><rect x="741" y="570" width="73" height="25" fill="#D2D2D2" stroke="none"/>' +
    '<rect x="840" y="470" width="75" height="275" rx="8" ry="8" fill="#FFFFFF"/><rect x="841" y="505" width="73" height="25" fill="#D2D2D2" stroke="none"/>' +
    '<g transform="rotate(-15)"><rect x="750" y="750" width="60" height="225" rx="8" ry="8" fill="#0080FF"/><rect x="751" y="785" width="58" height="25" fill="#0044B0" stroke="none"/></g>' +
    '<rect x="500" y="750" width="570" height="25" rx="8" ry="8" fill="#FFFFFF"/><rect x="530" y="780" width="25" height="25" rx="8" ry="8" fill="#FFFFFF"/><rect x="1020" y="780" width="25" height="25" rx="8" ry="8" fill="#FFFFFF"/>' +
    '</g></svg>';
  const HUB_LOGO_SVG = SVG_HEAD +
    '<g stroke="#000" stroke-width="2" stroke-linejoin="round">' +
    '<rect x="124" y="70" width="68" height="226" rx="8" ry="8" fill="#0080FF"/><rect x="125" y="104" width="66" height="22" fill="#0044B0" stroke="none"/>' +
    '<rect x="206" y="104" width="64" height="192" rx="8" ry="8" fill="#FFFFFF"/><rect x="207" y="136" width="62" height="22" fill="#D2D2D2" stroke="none"/>' +
    '<g transform="rotate(-15 318 296)"><rect x="292" y="118" width="54" height="178" rx="8" ry="8" fill="#0080FF"/><rect x="293" y="150" width="52" height="22" fill="#0044B0" stroke="none"/></g>' +
    '<rect x="92" y="300" width="328" height="22" rx="8" ry="8" fill="#FFFFFF"/>' +
    '<rect x="116" y="326" width="22" height="20" rx="8" ry="8" fill="#FFFFFF"/><rect x="374" y="326" width="22" height="20" rx="8" ry="8" fill="#FFFFFF"/>' +
    '<path d="M256 410 L182 470 M256 410 L256 478 M256 410 L330 470" fill="none" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round"/>' +
    '<circle cx="256" cy="410" r="34" fill="#0080FF"/>' +
    '<circle cx="182" cy="470" r="16" fill="#FFFFFF"/><circle cx="256" cy="478" r="16" fill="#FFFFFF"/><circle cx="330" cy="470" r="16" fill="#FFFFFF"/>' +
    '</g></svg>';
  // The logo for a sender: the host's own notifications carry `source: "hub"`; everything
  // else is the hosted plugin's.
  function logoSvg(source) { return source === "hub" ? HUB_LOGO_SVG : PLUGIN_LOGO_SVG; }

  /* Notification center: the last few notifications this host showed (title, body,
     time, read flag), re-readable in the hub view. Newest first, bounded; listeners
     re-render live. */
  const NOTIFY_CAP = 20;
  const notifyRing = [];
  const notifyListeners = [];
  let notifySeq = 0;
  function notifyEmit() {
    for (let i = 0; i < notifyListeners.length; i++) { try { notifyListeners[i](); } catch (e) {} }
  }
  // `extra` carries what the sender passed with it: `logo` / `icon` (React elements or an SVG
  // string) and `source` ("hub" for the host's own), so the center shows the same marks.
  function notifyRecord(title, body, extra) {
    const e = extra || {};
    notifyRing.unshift({ id: ++notifySeq, title: String(title || ""), body: String(body || ""), ts: Date.now(), read: false, logo: e.logo, icon: e.icon, source: e.source });
    if (notifyRing.length > NOTIFY_CAP) notifyRing.length = NOTIFY_CAP;
    notifyEmit();
  }
  function notifyUnread() {
    let n = 0;
    for (let i = 0; i < notifyRing.length; i++) if (!notifyRing[i].read) n++;
    return n;
  }
  function notifyMarkRead() {
    let changed = false;
    for (let i = 0; i < notifyRing.length; i++) if (!notifyRing[i].read) { notifyRing[i].read = true; changed = true; }
    if (changed) notifyEmit();
  }
  function notifyClear() { notifyRing.length = 0; notifyEmit(); }
  function notifySubscribe(fn) {
    notifyListeners.push(fn);
    return function () { const i = notifyListeners.indexOf(fn); if (i >= 0) notifyListeners.splice(i, 1); };
  }

  /* The copy of the bundle running here is the hub's own: as sole host, or under a
     loader once the cooperative-bundle hand-over happened — the loader's copy stood
     down (its defer signal, published before our copy boots) or our copy announced
     its boot. Plain coexistence and plain cooperation run the loader's copy, so a
     hub-driven swap would not take effect there. Read live: it changes during boot. */
  function hubBundleRuns() {
    if (!COEXIST) return true;
    if (!COOP || liveCfg().coopBundle !== true) return false;
    try {
      const defer = window.__DECK_SHELVES_DEFER_TO_HOST__;
      return typeof window.__DECK_SHELVES_HOST_BUNDLE_BOOTED__ === "string" || !!(defer && typeof defer === "object");
    } catch (e) { return false; }
  }

  // ── HostApi assembly ──────────────────────────────────────────────────────
  const mountHandlers = [], unmountHandlers = [];
  const host = {
    __shelvesRuntime: true,
    version: HOST_API_VERSION,
    // Identify this host + the capabilities it implements, so a bundle can adapt
    // without feature-detecting each member (contract `HostHandshake`). Computed per call,
    // so a tab inserted, a hand-over settled or a stamp rewritten after boot shows on a later read.
    handshake: function () {
      const cfg = liveCfg();
      const hs = {
        hostKind: "shelveshub",
        hostVersion: cfg.hostVersion || HOST_API_VERSION,
        hostApiVersion: HOST_API_VERSION,
        capabilities: {
          teardown: true,
          selfUpdate: hubBundleRuns(), // can install a PLUGIN update in place (see updates.canSelfInstall)
          nativeQam: QamHost._tabPresent(),
          coexist: !!COEXIST,
          // Cooperative-bundle protocol (daemon `coop_bundle`): under force this
          // host runs its OWN copy of the bundle, so the loader's copy may stand
          // down (contract 1.4.0 `coopBundle`).
          coopBundle: cfg.coopBundle === true,
        },
      };
      // Additive (contract 1.4.0): device identity + the bundle version this host
      // carries, both from the daemon's current stamp (a hot-swap rewrites it). Omitted
      // when the daemon is older (the bundle falls back to its own detection).
      if (cfg.device) hs.device = cfg.device;
      if (cfg.bundleVersion) hs.bundleVersion = cfg.bundleVersion;
      return hs;
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
      // handlers once; the daemon calls this over CDP before it clears its marker.
      teardown: function () {
        const pruning = _navPruneTimer !== null;
        const hs = unmountHandlers.splice(0, unmountHandlers.length);
        for (let i = 0; i < hs.length; i++) {
          try { hs[i](); } catch (e) { log("lifecycle.teardown handler:", e && e.message); }
        }
        // The nav prune is the host's own and stops with the handlers above; the
        // swapped-in bundle needs it again and nothing else re-arms it.
        if (pruning) startNavPrune();
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
    /* The concrete router hook — the plugin resolves this (falling back from a
       loader's hook) to register its screens and patch the home. Exposed both as
       `routerHook` (what the plugin looks for by name) and behind `routes`, which
       follows whatever `routerHook` holds (cooperation swaps in the loader's). */
    routerHook: routerHook,
    routes: {
      register: function (path, component) {
        host.routerHook.addRoute(path, component);
        return { dispose: function () { host.routerHook.removeRoute(path); } };
      },
      addRoute: function (path, component, props) { host.routerHook.addRoute(path, component, props); },
      removeRoute: function (path) { host.routerHook.removeRoute(path); },
      addPatch: function (path, patch) { return host.routerHook.addPatch(path, patch); },
      removePatch: function (path, patch) { return host.routerHook.removePatch(path, patch); },
    },
    notifications: {
      /* `logo` / `icon` (React elements the sender renders — what the plugin sends a loader)
         and `source` ("hub" for the host's own notifications) ride along; absent, the sender's
         default logo is used. */
      toast: function (opts) {
        opts = opts || {};
        this.send(opts.title || "", opts.body || "", opts.durationMs, { logo: opts.logo, icon: opts.icon, source: opts.source });
      },
      send: function (title, body, durationMs, extra) {
        notifyRecord(title, body, extra);
        // Steam's own pipeline (sound, tray, Steam chrome); when it is not up the
        // entry still lives in the hub view's Notifications section.
        let shown = false;
        try { shown = NativeToasts.push(title, body, durationMs, extra || {}); } catch (e) {}
        if (!shown) logWarn("NOTIFY", "kept in the hub view only: " + title + " - " + body);
      },
      // Host extras (not in the contract): the notification center behind the hub view.
      mode: function () { return NativeToasts.state(); },
      list: function () { return notifyRing.slice(); },
      unread: notifyUnread,
      markRead: notifyMarkRead,
      clear: notifyClear,
      subscribe: notifySubscribe,
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
       the bundle file, so the plugin's update UX can offer "Install" (not just
       "Download"). The daemon's file watch then hot-swaps the new bundle in place; a
       page reload here would race the ticking daemon into a mid-boot injection. */
    updates: {
      // True only while the copy that runs is the hub's own (hubBundleRuns): only then
      // does a hub-driven swap take effect. While the loader's copy runs, report false
      // and let the plugin keep its own update banner.
      canSelfInstall: function () { return hubBundleRuns(); },
      applyUpdate: function (release) {
        return fetch(RPC_ENDPOINT, { method: "POST", headers: rpcHeaders(), body: JSON.stringify({ method: "applyUpdate", args: release == null ? null : release }) })
          .then(function (res) { if (!res.ok) throw new Error("applyUpdate HTTP " + res.status); return res.json(); })
          .then(function (j) { if (!j.ok) throw new Error("applyUpdate: " + j.error); return j.result; });
      },
    },
    qam: QamHost,
    _steam: Steam,
  };

  /* The native QAM tab's registration surface (the contract's `HostQam`), on its own
     `window.__SHELVES_QAM__` global. It never participates in host selection, so a Deck
     Shelves under another loader can still feed THIS host's tab — the one safe coexist
     hook; idempotent (the first runtime to patch the tab stays the target). Ownership is
     the separate `__SHELVES_QAM_OWNER__` global, stamped only once our tab lands (pushTab). */
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
  // A class-map module: a plain object of only string values (CSS class maps),
  // excluding version-only and localization modules.
  function allStringValues(m, keys) {
    for (let i = 0; i < keys.length; i++) {
      const d = Object.getOwnPropertyDescriptor(m, keys[i]);
      if ((d && d.get) || typeof m[keys[i]] !== "string") return false;
    }
    return true;
  }
  function isClassMapModule(m) {
    if (!m || typeof m !== "object" || m.__esModule) return false;
    const keys = Object.keys(m);
    if (keys.length === 0 || keys.length >= 1000) return false;
    if (keys.length === 1 && m.version) return false; // a version-only module
    if (m.AboutSettings) return false; // the localization module
    return allStringValues(m, keys);
  }
  function buildClassMap() {
    const out = [];
    try {
      const it = Steam.modules.values();
      for (let n = it.next(); !n.done; n = it.next()) {
        if (isClassMapModule(n.value)) out.push(n.value);
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
  function hooksFromSecretInternals() {
    try {
      const d = React && React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
      if (d && d.ReactCurrentDispatcher && d.ReactCurrentDispatcher.current) return d.ReactCurrentDispatcher.current;
    } catch (e) {}
    return null;
  }
  function hooksFromClientInternals() {
    try {
      const ci = React && React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      if (ci) { for (const k in ci) { const p = ci[k]; if (p && p.useEffect) return p; } }
    } catch (e) {}
    return null;
  }
  // React's internal hook dispatcher (React 18 secret-internals OR React 19 client-internals).
  function internalHooks() {
    return hooksFromSecretInternals() || hooksFromClientInternals();
  }
  let _savedHooks = null, _tempSlot = null;
  /* Outside a render the slot can hold no dispatcher (React 19 keeps `H` null; React 18
     `ReactCurrentDispatcher.current` until its first render), so a component's first hook
     would throw: a stub dispatcher goes into that slot for the fake render and the old value
     comes back after it (the toast pre-flight does the same around its own run). */
  function installTempDispatcher() {
    let slot = null;
    try {
      const ci = React && React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const d = React && React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
      if (ci && "H" in ci) slot = { obj: ci, key: "H" };
      else if (d && d.ReactCurrentDispatcher) slot = { obj: d.ReactCurrentDispatcher, key: "current" };
    } catch (e) {}
    if (!slot) return null;
    slot.had = slot.obj[slot.key];
    _tempSlot = slot;
    return (slot.obj[slot.key] = {});
  }
  function stubHooks(h, customHooks) {
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
  function applyHookStubs(customHooks) {
    const h = internalHooks();
    if (!h) { const t = installTempDispatcher(); return t ? stubHooks(t, customHooks) : null; }
    _savedHooks = {
      useContext: h.useContext, useCallback: h.useCallback, useLayoutEffect: h.useLayoutEffect,
      useEffect: h.useEffect, useMemo: h.useMemo, useRef: h.useRef, useState: h.useState,
    };
    return stubHooks(h, customHooks);
  }
  function removeHookStubs() {
    if (_tempSlot) { _tempSlot.obj[_tempSlot.key] = _tempSlot.had; _tempSlot = null; return; }
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

  /* Augment `host.ui` IN PLACE with the extra helpers the plugin's menu/class code needs
     (webpack finders, react-tree/patch utils, GamepadButton, menu sub-components, native
     class maps) — no loader-named global, the host stays neutral. These must resolve BEFORE
     the bundle is released (signalUiReady), but the scans are heavy enough to starve Steam's
     home render, so run them CHUNKED (one per timer tick, yielding) and call onDone after. */
  function augmentHostUi(onDone) {
    if (UI.__loaderAugmented || !React) { if (onDone) onDone(); return; }
    UI.__loaderAugmented = true;
    // Cheap reference/literal assignments (no scans): all called on demand, never at boot.
    // afterPatch preserves the original's React shape (memo / forwardRef / function) — the
    // native-recents replace patches `element.type` memo OBJECTS, where a naive wrapper threw.
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
  function navTreeArray(ctx) {
    const trees = ctx.m_rgGamepadNavigationTrees;
    if (Array.isArray(trees)) return trees;
    return trees.values ? Array.from(trees.values()) : [];
  }
  function mainNavRoot() {
    const ctrl = window.FocusNavController;
    if (!ctrl) return null;
    const ctx = ctrl.m_ActiveContext || ctrl.m_LastActiveContext;
    if (!ctx || !ctx.m_rgGamepadNavigationTrees) return null;
    const arr = navTreeArray(ctx);
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (t && t.m_ID === "GamepadUI_Full_Root") return t.Root || t.m_Root || null;
    }
    return null;
  }

  /* Sole host: hidden native home sections stay 0x0 but remain FOCUSABLE nav nodes, so DOWN
     from the search bar stops on each invisible one before our shelves (extra dpad presses).
     Remove 0x0 nodes that aren't ours from the home nav tree, REVERSIBLY — each is recorded
     and put back the moment its element is visible again, so re-enabling a section still works.
     A CSS show/hide doesn't rebuild the tree, so this re-runs on a modest interval. */
  const _prunedNodes = [];
  // Restore pass: any node we removed whose element is now VISIBLE again goes back into its
  // parent (clearing m_bChildrenSorted makes Steam re-sort by DOM position); drop detached
  // records. Returns true when the tree changed.
  function reattachNode(rec) {
    if (rec.parent && rec.parent.m_rgChildren && rec.parent.m_rgChildren.indexOf(rec.node) < 0) {
      rec.parent.m_rgChildren.push(rec.node);
      rec.parent.m_bChildrenSorted = false;
      return true;
    }
    return false;
  }
  function restorePrunedNodes(zeroSize) {
    let touched = false;
    for (let k = _prunedNodes.length - 1; k >= 0; k--) {
      const rec = _prunedNodes[k];
      const el = rec.node && rec.node.m_element;
      const attached = !!(el && el.ownerDocument && el.ownerDocument.contains(el));
      if (!attached) { _prunedNodes.splice(k, 1); continue; }
      if (!zeroSize(el)) {
        try { if (reattachNode(rec)) touched = true; } catch (e) {}
        _prunedNodes.splice(k, 1);
      }
    }
    return touched;
  }
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
      let touched = restorePrunedNodes(zeroSize);
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
  // The Home is drawn by the gamepad UI's main window; its document says whether
  // anything can be on screen. This context's own document is the fallback.
  function homeWindowDocument() {
    try {
      const ws = window.SteamUIStore && window.SteamUIStore.WindowStore;
      const bw = ws && ws.GamepadUIMainWindowInstance && ws.GamepadUIMainWindowInstance.m_BrowserWindow;
      if (bw && bw.document && typeof bw.document.hidden === "boolean") return bw.document;
    } catch (e) {}
    return document;
  }
  let _navPruneTimer = null;
  function stopNavPrune() {
    if (_navPruneTimer) { clearInterval(_navPruneTimer); _navPruneTimer = null; }
  }
  function startNavPrune() {
    if (_navPruneTimer) return;
    // Pause the work while the Home's window is hidden (game in front / UI off) so
    // the poll costs nothing when it can't matter; the stop path sits with the
    // bundle's unmount handlers, and teardown re-arms it for the next bundle.
    _navPruneTimer = setInterval(function () {
      try { if (homeWindowDocument().hidden) return; } catch (e) {}
      pruneHiddenNavNodes();
    }, 500);
    unmountHandlers.push(stopNavPrune);
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
