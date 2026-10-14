/* runtime/shelves-host-toast.js — host notifications through Steam's OWN toast pipeline (sole
   host, opt-in): push into NotificationStore and render our entries with Steam's toast chrome by
   wrapping the toast renderer the way a plugin loader does — a trampoline that lets a bare
   function component be patched. Without it, entries stay in the hub view's center. Assembled last. */

  const NativeToasts = (function () {
    const CALL_ORIGINAL = {};
    const TOAST_ETYPE = 31;        // a type Steam never renders itself (the loader uses the same)
    const TOAST_SOURCE_CLIENT = 1;
    const TOAST_TYPE_NEW = 0;      // ToastType.New
    const TOAST_SOUND_MISC = 6;    // the stock "ToastMisc" sound
    const TOAST_LOCATION_POPUP = 1; // the location Steam's gamepad toast popup renders with
    const DISCOVERY_DELAY_MS = 2500;
    const QUEUE_CAP = 10;
    let state = "off";             // off | pending | active | failed
    let parts = null;              // { slot, chrome, header, body }
    let queued = []; // sent before the pipeline settled (the plugin's boot notices land ~1 s after inject)

    function srcOf(e) { try { return typeof e === "function" ? e.toString() : ""; } catch (err) { return ""; } }
    function pick(mod, test) {
      if (!mod) return null;
      const vals = Object.values(mod);
      for (let i = 0; i < vals.length; i++) { if (typeof vals[i] === "function" && test(srcOf(vals[i]))) return vals[i]; }
      return null;
    }
    /* Steam's toast renderer (the per-type switch) and its chrome: the frame every toast
       uses, the header (title + timestamp) and the description body. All matched by source
       text, never by minified export names. null = a Steam change we don't recognise. */
    function discover() {
      const rendererMod = Steam.findModuleByExport(function (e) { return srcOf(e).indexOf('controller:"notification",method:') >= 0; });
      const renderer = pick(rendererMod, function (s) { return s.indexOf('controller:"notification",method:') >= 0; });
      const chrome = pick(rendererMod, function (s) { return s.indexOf("Missing activate function") >= 0; });
      const chromeMod = Steam.findModuleByExport(function (e) { const s = srcOf(e); return s.indexOf("nUnread") >= 0 && s.indexOf("DesktopToastTemplate") >= 0; });
      const header = pick(chromeMod, function (s) { return s.indexOf("fnRenderTimestamp") >= 0; });
      const body = pick(chromeMod, function (s) { return s.indexOf("StandardNotificationDescription") >= 0 && s.indexOf("multiline") >= 0; });
      if (!renderer || !chrome || !header || !body) return null;
      // The plate Steam's short popup toasts use; without it popups keep the list-row look.
      const short = findClassModule(["ShortTemplate", "TwoLine", "ShortLogoDimensions", "Content", "Title", "Body"]);
      return { renderer: renderer, chrome: chrome, header: header, body: body, short: short };
    }
    /* Pre-flight: the renderer body must survive a run for OUR type under the SAME hook
       stubs the trampoline applies during construction (an empty group: elements only, no
       per-type component runs) — else never install. A dispatcher is put in place for the
       run (outside a render there may be none) and restored after. */
    function survivesStubs(renderer) {
      const ci = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      if (!ci) return false;
      const had = ci.H;
      ci.H = { useEffect: function () {} };
      let ok = false;
      applyHookStubs();
      try { renderer({ group: { eType: TOAST_ETYPE, notifications: [] }, location: 0 }); ok = true; } catch (e) { ok = false; }
      finally { removeHookStubs(); ci.H = had; }
      return ok;
    }
    function reactReady() {
      try {
        const w = window;
        return !!(w.SP_REACT && w.SP_JSX && w.SP_REACTDOM && typeof w.SP_REACTDOM.version === "string"
          && w.SP_REACTDOM.version.indexOf("19.") === 0);
      } catch (e) { return false; }
    }
    /* The trampoline. React treats a function whose prototype carries `isReactComponent` as a
       class: construction runs the original body once with hooks and element creation stubbed
       (every element it makes is an instance carrying our `render`), and `render` then draws the
       ORIGINAL as a real function component through a slot we can patch. Stubs go on at the
       `contextType._currentValue` read just before construction, off at the `updater` assign. */
    function injectTrampoline(component) {
      if (component.__shelvesTrampoline) return component.__shelvesTrampoline;
      if (component.prototype.isReactComponent) return null; // someone else's — never double-wrap
      const inner = function () { return component.apply(this, arguments); };
      const slot = { component: inner };
      component.prototype.render = function () {
        return window.SP_REACT.createElement(slot.component, this.props, this.props.children);
      };
      component.prototype.isReactComponent = true;
      let stubs = false, step = 0, saved = null;
      const make = function () { return Object.create(component.prototype); };
      // Snapshot at apply time, not install time: the hosted bundle wraps these too,
      // and whoever wrapped last must get its function back.
      const apply = function () {
        if (stubs) return;
        stubs = true;
        saved = { ce: window.SP_REACT.createElement, jsx: window.SP_JSX.jsx, jsxs: window.SP_JSX.jsxs };
        applyHookStubs();
        window.SP_REACT.createElement = make; window.SP_JSX.jsx = make; window.SP_JSX.jsxs = make;
      };
      const remove = function () {
        if (!stubs) return;
        stubs = false;
        removeHookStubs();
        window.SP_REACT.createElement = saved.ce; window.SP_JSX.jsx = saved.jsx; window.SP_JSX.jsxs = saved.jsxs;
        saved = null;
      };
      const leave = function () { if (step === 1 || step === 2) { step = 0; remove(); } };
      Object.defineProperty(component, "contextType", {
        configurable: true,
        get: function () {
          if (step === 0) step = 1;
          if (this._shelvesContextType == null) this._shelvesContextType = {};
          const ct = this._shelvesContextType;
          if (!ct.__shelvesHooked) {
            ct.__shelvesHooked = true;
            Object.defineProperty(ct, "_currentValue", {
              configurable: true,
              get: function () { if (step === 1) { step = 2; apply(); } return this.__shelvesValue; },
              set: function (v) { this.__shelvesValue = v; },
            });
          }
          return ct;
        },
        set: function (v) { this._shelvesContextType = v; },
      });
      Object.defineProperty(component.prototype, "updater", {
        configurable: true,
        get: function () { return this._shelvesUpdater; },
        set: function (v) { leave(); this._shelvesUpdater = v; },
      });
      Object.defineProperty(component, "getDerivedStateFromProps", {
        configurable: true,
        get: function () { leave(); return this._shelvesGdsfp; },
        set: function (v) { this._shelvesGdsfp = v; },
      });
      component.__shelvesTrampoline = slot;
      return slot;
    }
    // Replace a slot's function: the handler sees `[args]` and returns CALL_ORIGINAL to defer.
    function replaceSlot(slot, handler) {
      const original = slot.component;
      slot.component = function () {
        const args = Array.prototype.slice.call(arguments);
        let ret;
        try { ret = handler.call(this, args); } catch (e) { ret = CALL_ORIGINAL; }
        return ret === CALL_ORIGINAL ? original.apply(this, args) : ret;
      };
    }
    function isElement(v) { return !!(v && typeof v === "object" && v.$$typeof); }
    // The sender's logo: a React element as given, an SVG string, else the default by source.
    function logoNode(d) {
      if (isElement(d.logo)) return d.logo;
      const svg = (typeof d.logo === "string" && d.logo.indexOf("<svg") === 0) ? d.logo : logoSvg(d.source);
      return h("div", {
        style: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" },
        dangerouslySetInnerHTML: { __html: svg },
      });
    }
    /* A popup entry on Steam's short-toast plate (dark, shadowed, up to two lines), the structure
       Steam's own short popups have: logo, then title (with the per-type icon) over the body. */
    function PopupToast(sc, d, icon, onActivate) {
      return h("div", { className: sc.ShortTemplate + " " + sc.TwoLine, onClick: onActivate },
        h("div", { key: "l", className: sc.ShortLogoDimensions }, logoNode(d)),
        h("div", { key: "c", className: sc.Content + (sc.FullWidth ? " " + sc.FullWidth : "") },
          h("div", { key: "h", className: sc.Header }, icon ? h("div", { key: "i", className: sc.Icon }, icon) : null, h("div", { key: "t", className: sc.Title }, d.title)),
          h("div", { key: "b", className: sc.Body }, d.body)));
    }
    // One of our entries, in Steam's chrome: frame + header (per-type icon, title, timestamp)
    // + body, the sender's logo on the left. Tapping it dismisses, as Steam's simple toasts do.
    function HostToast(props) {
      const n = props.notification, d = n.data || {};
      const onActivate = function () { if (typeof props.onDismiss === "function") props.onDismiss(); };
      const icon = isElement(d.icon) ? d.icon : undefined;
      if (props.location === TOAST_LOCATION_POPUP && parts.short) return PopupToast(parts.short, d, icon, onActivate);
      return h(parts.chrome, { location: props.location, logo: logoNode(d), onActivate: onActivate, bNewIndicator: n.bNewIndicator },
        h(parts.header, { key: "h", icon: icon, title: d.title, location: props.location, timestamp: n.rtCreated }),
        h(parts.body, { key: "b", multiline: true }, d.body));
    }
    function isOurs(group) {
      const first = group && group.notifications && group.notifications[0];
      return !!(group && group.shelveshub) || !!(first && first.shelveshub);
    }
    function handler(args) {
      const p = args && args[0];
      if (!p || !isOurs(p.group)) return CALL_ORIGINAL;
      return p.group.notifications.map(function (n) {
        const el = h(HostToast, { key: n.nNotificationID, notification: n, location: p.location, onDismiss: p.onDismiss });
        return ErrorBoundary ? h(ErrorBoundary, { key: n.nNotificationID, fallback: null }, el) : el;
      });
    }
    function flush() {
      const items = queued;
      queued = [];
      if (state !== "active") {
        if (items.length) logWarn("NOTIFY", items.length + " notification(s) kept in the hub view only (Steam's pipeline is not up).");
        return;
      }
      items.forEach(function (q) { pushNow(q.title, q.body, q.durationMs, q.extra); });
    }
    function install() {
      state = "failed";
      try {
        const NS = window.NotificationStore;
        if (!NS || typeof NS.ProcessNotification !== "function") { logWarn("NOTIFY", "native toasts: no NotificationStore — notifications stay in the hub view."); return; }
        const found = discover();
        if (!found) { logWarn("NOTIFY", "native toasts: Steam's toast renderer/chrome not recognised — notifications stay in the hub view."); return; }
        if (!survivesStubs(found.renderer)) { logWarn("NOTIFY", "native toasts: renderer pre-flight failed — notifications stay in the hub view."); return; }
        const slot = injectTrampoline(found.renderer);
        if (!slot) { logWarn("NOTIFY", "native toasts: renderer already wrapped by another host — notifications stay in the hub view."); return; }
        replaceSlot(slot, handler);
        parts = { slot: slot, chrome: found.chrome, header: found.header, body: found.body, short: found.short };
        state = "active";
        logInfo("NOTIFY", "native toasts active (Steam's toast pipeline + chrome).");
      } catch (e) {
        logWarn("NOTIFY", "native toasts install failed: " + (e && e.message) + " — notifications stay in the hub view.");
      } finally {
        flush();
      }
    }
    // Off the inject path: discovery scans run once the renderer has settled. A React
    // this port doesn't cover fails right away, so nothing waits for nothing.
    function boot() {
      if (state !== "off") return;
      if (!reactReady()) { state = "failed"; logWarn("NOTIFY", "native toasts: React globals not ready — notifications stay in the hub view."); return; }
      state = "pending";
      setTimeout(install, DISCOVERY_DELAY_MS);
    }
    // While the pipeline is coming up, hold the toast (bounded); once settled, send now.
    function push(title, body, durationMs, extra) {
      if (state === "pending") {
        if (queued.length < QUEUE_CAP) queued.push({ title: title, body: body, durationMs: durationMs, extra: extra || {} });
        return true;
      }
      return state === "active" && pushNow(title, body, durationMs, extra || {});
    }
    // Push one notification through Steam's store: it dispatches the toast (sound, duration,
    // position per the user's settings) and files it in the tray, where our handler draws it.
    function pushNow(title, body, durationMs, extra) {
      const NS = window.NotificationStore;
      const duration = (typeof durationMs === "number" && durationMs > 0) ? durationMs : 5000;
      const id = NS.m_nNextTestNotificationID++;
      const data = {
        nNotificationID: id, notificationID: id, bNewIndicator: true, rtCreated: Date.now(),
        eType: TOAST_ETYPE, eSource: TOAST_SOURCE_CLIENT, nToastDurationMS: duration,
        data: { title: String(title || ""), body: String(body || ""), duration: duration, logo: extra.logo, icon: extra.icon, source: extra.source },
        shelveshub: true,
      };
      const info = {
        showToast: true, sound: TOAST_SOUND_MISC, playSound: true, eFeature: 0,
        toastDurationMS: duration, bCritical: false,
        fnTray: function (t, tray) { tray.unshift({ eType: t.eType, notifications: [t], shelveshub: true }); },
      };
      try { NS.ProcessNotification(info, data, TOAST_TYPE_NEW); return true; }
      catch (e) { logWarn("NOTIFY", "native toast push failed: " + (e && e.message)); return false; }
    }
    return { boot: boot, push: push, active: function () { return state === "active"; }, state: function () { return state; } };
  })();

  // Sole host only — under a loader its toaster owns the plugin's toasts (and the renderer).
  (function () {
    let on = false;
    try { on = window.__SHELVES_NATIVE_NOTIFICATIONS__ === true; } catch (e) {}
    if (on && !COEXIST) NativeToasts.boot();
  })();

  /* Host notices from the daemon (an update landed, a rollback is staged, a recovery ran, …):
     worded here from the runtime's dictionaries and shown as the host's own notification —
     through Steam's pipeline on a sole host, or beside another host through its toaster (the
     one place this runtime borrows it), so they read like every other notification there. */
  function formatNotice(text, params) {
    return String(text).replace(/\{(\w+)\}/g, function (m, k) { return params && params[k] != null ? String(params[k]) : m; });
  }
  function borrowedToaster() {
    try {
      const l = window.DeckyPluginLoader;
      const t = l && l.toaster;
      return (t && typeof t.toast === "function") ? t : null;
    } catch (e) { return null; }
  }
  function hostNotice(key, params) {
    const title = I18N.t("hub_title");
    const body = formatNotice(I18N.t(key), params);
    if (!COEXIST) {
      host.notifications.send(title, body, undefined, { source: "hub" });
      return true;
    }
    notifyRecord(title, body, { source: "hub" });
    const t = borrowedToaster();
    if (!t) return false;
    const logo = h("div", { style: { width: "40px", height: "40px" }, dangerouslySetInnerHTML: { __html: HUB_LOGO_SVG } });
    try { t.toast({ title: title, body: body, logo: logo, duration: 5000 }); return true; } catch (e) { return false; }
  }
  try { window.__SHELVES_NOTIFY__ = hostNotice; } catch (e) {}
