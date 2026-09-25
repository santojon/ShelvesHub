// runtime/shelves-host-qam.js — QAM host section (native Quick Access tab, panel,
// native-menu patching). Assembled with shelves-host.js into ONE injected IIFE by
// the loader (shared closure); not a standalone module — see shelves-host.js.

  const QamHost = (function () {
    const KEY_PREFIX = "shelves-";
    /* Native QAM tab is config-driven: the daemon stamps
       `window.__SHELVES_NATIVE_QAM__ = true` (env SHELVES_NATIVE_QAM=1) before
       injecting this runtime. Off by default so the deployed state is stable —
       validate on a non-primary device first; it touches the Steam renderer. */
    let NATIVE_QAM_ENABLED = (function () {
      try { return window.__SHELVES_NATIVE_QAM__ === true; } catch (_) { return false; }
    })();
    const specs = {};
    let patched = false;
    let confirmed = false;
    let lastVisible = true;

    // Trip breaker: "armed" is written just before patching and cleared on the
    // first healthy render through our handler. If a boot finds "armed" left
    // over, the previous arm never confirmed (renderer likely died) — trip and
    // refuse the native path until the key is cleared manually. Guarantees at
    // most one bad arm, never a crash loop. All storage access is fail-safe
    // (CEF contexts can deny localStorage).
    const TRIP_KEY = "shelves.nativeQamTrip";
    function tripGet() { try { return window.localStorage.getItem(TRIP_KEY); } catch (_) { return null; } }
    function tripSet(v) { try { window.localStorage.setItem(TRIP_KEY, v); } catch (_) {} }
    function tripClear() { try { window.localStorage.removeItem(TRIP_KEY); } catch (_) {} }
    let tripped = false;
    /* A RECENT arm is a legitimate boot double-inject (the renderer reloaded before
       our first healthy render — common mid-boot), so re-arm cleanly instead of
       tripping. Only a STALE arm (a genuinely dead previous session) trips. Arms are
       stamped `armed:<ms>`; a bare `armed` (pre-timestamp runtime) counts as stale. */
    const STALE_ARM_MS = 15000;
    /* The breaker guards ONLY the sole/owner path, where the webpack UI scan can
       black-screen. In COEXIST the UI is borrowed from the loader (no scan, no
       collapse risk), so the breaker must never engage there — otherwise an armed
       state left by a restart before the QAM first renders would false-trip and
       silently kill our tab on every later boot. */
    if (NATIVE_QAM_ENABLED && !COEXIST) {
      const prior = tripGet();
      if (prior && prior.indexOf("armed") === 0) {
        const armTs = parseInt(prior.split(":")[1] || "0", 10) || 0;
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
      const spec = props.spec;
      const ref = React.useRef(null);
      React.useEffect(function () {
        if (!ref.current) return undefined;
        let cleanup;
        try { cleanup = spec.render(ref.current); } catch (e) { log("qam panel render:", e && e.message); }
        return typeof cleanup === "function" ? cleanup : undefined;
      }, []);
      return h("div", { ref: ref, style: { width: "100%", height: "100%" } });
    }
    function contentEl(spec) {
      const inner = typeof spec.render === "function"
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
    const slotListeners = [];
    function notifySlots() {
      for (let i = 0; i < slotListeners.length; i++) {
        try { slotListeners[i](function (n) { return n + 1; }); } catch (e) {}
      }
    }
    // Diagnostic: lets a controlled native-render test force a slot re-render from
    // the debugger after flipping window.__SHELVES_NATIVE_UI__ (see nativeUiOn()).
    try { window.__SHELVES_REFRESH__ = notifySlots; } catch (e) {}
    function useSlotRefresh() {
      const st = React.useState(0);
      React.useEffect(function () {
        slotListeners.push(st[1]);
        return function () {
          const i = slotListeners.indexOf(st[1]);
          if (i >= 0) slotListeners.splice(i, 1);
        };
      }, []);
    }
    function firstSpec() {
      const ids = Object.keys(specs);
      return ids.length ? specs[ids[0]] : null;
    }
    // Deck Shelves' own tab icon (mirrors the plugin's assets/tab-icon.svg:
    // tintable single-colour, reads at ~18px). A registered spec's icon still
    // overrides it the moment the bundle registers a panel.
    const DEFAULT_ICON =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
      '<rect x="3.8" y="7.5" width="3.9" height="11.5" rx="0.8"/>' +
      '<rect x="8.7" y="5" width="3.9" height="14" rx="0.8"/>' +
      '<rect x="14" y="8" width="3.9" height="11" rx="0.8" transform="rotate(-13 15.95 19)"/>' +
      '<rect x="2.4" y="19" width="19.2" height="2.5" rx="0.9"/></svg>';
    function TabIconSlot() {
      useSlotRefresh();
      const s = firstSpec();
      return iconEl((s && s.icon) || DEFAULT_ICON);
    }
    // POST a JSON-RPC call to the local host RPC server (same transport as
    // `host.rpc.call`) — used by the fallback panel's actions.
    function hostRpc(method, args) {
      return fetch(RPC_ENDPOINT, {
        method: "POST",
        headers: rpcHeaders(),
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
    const FALLBACK_ICONS = {
      download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M8 11l4 4 4-4"/><path d="M5 20h14"/></svg>',
      update: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/></svg>',
      logs: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/></svg>',
      auto: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
      back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
      refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
      trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
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
      const props = focusableComp
        ? { onActivate: onAct, focusClassName: "shelves-gpfocus" }
        : { onClick: onAct };
      if (extra) for (const k in extra) props[k] = extra[k];
      return React.createElement.apply(React, [focusableComp || "button", props].concat(kids || []));
    }
    // Plugin-style collapsible section (chevron header + persisted open state +
    // separator + content), mirroring the plugin's CollapsibleSection so the hub's
    // Advanced area reads the same. Its own component so each section keeps state.
    const HUB_SECTIONS_KEY = "ds-hub-sections";
    function readHubSections() { try { return JSON.parse(localStorage.getItem(HUB_SECTIONS_KEY) || "{}"); } catch (e) { return {}; } }
    function HubCollapsible(props) {
      const id = props.id, title = props.title;
      const s0 = readHubSections();
      const initial = (id in s0) ? !!s0[id] : props.initialOpen === true;
      const st = React.useState(initial);
      const open = st[0], setOpen = st[1];
      const toggle = function () {
        setOpen(function (o) {
          const n = !o;
          try { const s = readHubSections(); s[id] = n; localStorage.setItem(HUB_SECTIONS_KEY, JSON.stringify(s)); } catch (e) {}
          return n;
        });
      };
      // Flat QAM look (like the plugin): uppercase dim header, whole-row focus
      // highlight (background, not a ring), thin separator, no surrounding box.
      // When collapsed, a count badge (like the plugin's) hints at the contents.
      const chevron = h("span", { key: "c", style: { fontSize: "9px", opacity: 0.7, flex: "0 0 auto" } }, open ? "▲" : "▼");
      const titleEl = h("span", { key: "t", style: { flex: "1 1 auto", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, title);
      const right = [];
      if (!open && typeof props.count === "number" && props.count > 0) {
        right.push(h("span", { key: "b", style: { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "18px", height: "18px", padding: "0 6px", borderRadius: "9px", background: "rgba(255,255,255,0.14)", fontSize: "10px", fontWeight: "700" } }, String(props.count)));
      }
      right.push(chevron);
      const rightEl = h("span", { key: "r", style: { display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto" } }, right);
      const hStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: "40px", boxSizing: "border-box", width: "100%", padding: "8px 16px", cursor: "pointer", fontWeight: "600", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px", color: "rgba(255,255,255,0.72)" };
      const header = focusableComp
        ? h(focusableComp, { key: "h", "data-fb": "sec-" + id, onActivate: toggle, onOKButton: toggle, focusClassName: "shelves-rowfocus", style: hStyle }, titleEl, rightEl)
        : h("div", { key: "h", "data-fb": "sec-" + id, onClick: toggle, style: hStyle }, titleEl, rightEl);
      const kids = [header];
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
      const onBack = props && props.onBack;
      const st = React.useState(null);
      const busy = st[0], setBusy = st[1];
      // null = still loading; then the full update-preference object mirrors the
      // store: the master switch, the per-target switches, and their beta
      // channels. Per-target switches default ON (see HubSettings::default).
      const DEFAULT_UPD = { auto_update: false, auto_update_hub: true, hub_prerelease: false, auto_update_plugin: true, plugin_prerelease: false };
      const au = React.useState(null);
      const cfg = au[0], setCfg = au[1];
      // null = hub view; an array = the log viewer showing merged daemon+runtime lines.
      const lg = React.useState(null);
      const logs = lg[0], setLogs = lg[1];
      // Advanced section: `rc` holds the runtime-config mirror (getRuntimeConfig),
      // fetched once on mount; `rcDirty` flags an edit this session so a "restart
      // to apply" note shows. The collapsible open state lives in HubCollapsible.
      const rcS = React.useState(null);
      const rc = rcS[0], setRc = rcS[1];
      const rd = React.useState(false);
      const rcDirty = rd[0], setRcDirty = rd[1];
      React.useEffect(function () {
        let alive = true;
        hostRpc("getRuntimeConfig").then(function (r) {
          if (alive && r && r.ok && r.result && typeof r.result === "object") setRc(r.result);
        }, function () {});
        return function () { alive = false; };
      }, []);
      function mergeRc(patch) { const n = {}; if (rc) for (const k in rc) n[k] = rc[k]; for (const p in patch) n[p] = patch[p]; setRc(n); }
      function applyPaused(v) { mergeRc({ paused: v }); hostRpc("setHostingPaused", v).then(function () {}, function () {}); }
      // The boot animation is a live toggle: the daemon installs/removes the movie
      // on the spot. The movie itself is only read by Steam on its next start, so
      // surface the "restart to apply" banner (Steam replays the startup movie).
      function applyBootMovie(v) { mergeRc({ boot_movie: v }); setRcDirty(true); hostRpc("setBootMovie", v).then(function () {}, function () {}); }
      function applyCfg(key, val) { mergeRc((function () { const o = {}; o[key] = val; return o; })()); setRcDirty(true); hostRpc("setRuntimeConfig", { key: key, value: val }).then(function () {}, function () {}); }
      /* Apply pending config edits: restart the daemon so it re-reads the config
         file (values are only read at startup), then restart Steam so the fresh
         daemon claims/injects on a clean boot (needed for an ownership change,
         harmless otherwise). Shown as a top button while edits are dirty. */
      function doApplyRestart() {
        if (busy) return;
        setBusy("restart");
        hostRpc("restartService", {}).then(function () {}, function () {});
        setTimeout(function () {
          try { const u = window.SteamClient && window.SteamClient.User; if (u && typeof u.StartRestart === "function") u.StartRestart(false); } catch (e) {}
        }, 600);
      }
      /* Same pattern as the pinned "ShelvesHub" button (native DialogButton when
         available, else the subtle inset row) — matched colour and alignment.
         Full-width action button shared by the restart and hub-update banners,
         so both look and behave the same (icon + centered label; native
         DialogButton when available, focusable clickable fallback otherwise). */
      function bannerButton(dataFb, label, onClick) {
        return (nativeUiOn() && UI.DialogButton)
          ? h(UI.DialogButton, { "data-fb": dataFb, onClick: onClick, style: { width: "100%" } },
              h("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" } }, fbIcon("update"), h("span", null, label)))
          : clickable(onClick, {
              "data-fb": dataFb, focusClassName: "shelves-gpfocus",
              style: {
                flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center",
                gap: "8px", width: "100%", boxSizing: "border-box", padding: "10px 14px",
                border: "none", borderRadius: "4px",
                background: "rgba(255,255,255,0.05)", color: "#fff", cursor: busy ? "default" : "pointer",
                fontSize: "13px", opacity: busy ? 0.6 : 1,
              },
            }, [fbIcon("update"), h("span", { key: "t" }, label)]);
      }
      function restartBanner() {
        return h("div", { key: "restart-banner", style: { padding: "10px 14px 8px" } },
          bannerButton("apply-restart", I18N.t("adv_restart_apply"), doApplyRestart));
      }
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
        let alive = true;
        hostRpc("getConfig").then(function (r) {
          if (!alive) return;
          setCfg(r && r.ok && r.result && typeof r.result === "object" ? r.result : DEFAULT_UPD);
        }, function () { if (alive) setCfg(DEFAULT_UPD); });
        return function () { alive = false; };
      }, []);
      // While the log viewer is open, poll getLogs so new lines appear live (like
      // the plugin's log view) instead of a one-time snapshot.
      React.useEffect(function () {
        if (logs === null) return undefined;
        const iv = setInterval(function () {
          hostRpc("getLogs", 200).then(function (r) {
            if (r && r.ok && Array.isArray(r.result)) setLogs(r.result);
          }, function () {});
        }, 1500);
        return function () { clearInterval(iv); };
      }, [logs === null]);
      // Effective config for this render (defaults while still loading).
      const uc = cfg || DEFAULT_UPD;
      const on = uc.auto_update === true;
      /* Coexisting with another loader (it owns the renderer): the hub does NOT
         host or update the plugin here — the loader does, so the update actions
         and auto-update toggles are hidden and a note points at the loader.
         COOPERATIVE (a loader present but WE forced ownership) means the hub owns
         + manages updates → not coexist; COOP is reliable, the owner can lag. */
      const coexist = !COOP && (function () { try { const o = window.__DECK_SHELVES_OWNER__; return !!(o && o !== "shelveshub"); } catch (e) { return false; } })();
      /* B (CANCEL) handling: a plain onCancel/onCancelButton is NOT enough — the
         QAM router still navigates the tab away. We must ABSORB the button-down
         (preventDefault + stopImmediatePropagation on the event AND its inner
         event), then run our own back action. Mirrors the plugin's sidecar cancel. */
      function makeBackButtonDown(back) {
        return function (evt) {
          try {
            const d = evt && evt.detail;
            if (!d || d.button !== 2) return false; // 2 = CANCEL (B)
            try { evt.preventDefault(); evt.stopImmediatePropagation(); } catch (e) {}
            try { const inner = d.event; if (inner) { inner.preventDefault(); inner.stopImmediatePropagation(); } } catch (e) {}
            back();
            return true;
          } catch (e) { return false; }
        };
      }
      const backToHub = function () { setLogs(null); };
      /* B follows the CURRENT context, not always "back to Deck Shelves":
         inside the expanded log panel B collapses it back to the hub screen;
         otherwise (opened from the editor) B returns to Deck Shelves. When
         neither applies (standalone hub, logs closed) B falls through to close
         the tab as usual. */
      const contextualBack = (logs !== null) ? backToHub : (onBack || null);
      // Root wrapper for the hub view: when there is a contextual back action,
      // wrap in a Focusable that absorbs B and runs it instead of letting the
      // QAM router navigate the tab away.
      function panelRoot(baseProps, kids) {
        const useFocus = !!(contextualBack && focusableComp);
        const props = {};
        for (const k in baseProps) props[k] = baseProps[k];
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
        const ver = uc.pending_hub_update;
        if (typeof ver !== "string" || !ver) return null;
        /* Once the update has been downloaded and staged over the binary, the
           wording shifts from "restart to update" to "downloaded — restart to
           finish" (a relaunching service applies it on its own, so this only ever
           shows for a manually-run daemon). */
        const label = uc.hub_update_staged === true ? "hub_update_staged" : "hub_update_restart";
        return h("div", { key: "hubupd", style: { padding: "10px 14px 8px" } },
          bannerButton("hub-update", I18N.t(label) + " (" + ver + ")", doApplyRestart));
      }
      // The "Advanced" area: a plugin-style collapsible whose content is grouped
      // into collapsible sub-sections (Troubleshooting / Configuration / Status),
      // with localized labels, centered steppers, and focusable rows.
      const advRowStyle = { display: "flex", alignItems: "center", gap: "10px", minHeight: "40px", width: "100%", boxSizing: "border-box", padding: "6px 16px", border: "none", background: "transparent", color: "#fff", cursor: "pointer", fontSize: "13px" };
      // Short explanatory subtext under a field label (localized). Muted + tight.
      const advSubStyle = { fontSize: "11px", color: "rgba(255,255,255,0.55)", lineHeight: "1.3", marginTop: "1px" };
      const advLabelCol = function (label, sub) {
        return h("div", { key: "t", style: { flex: "1 1 auto", textAlign: "left", display: "flex", flexDirection: "column", gap: "1px", minWidth: "0" } },
          [h("span", { key: "lb" }, label), sub ? h("span", { key: "sb", style: advSubStyle }, sub) : null]);
      };
      const advToggleRow = function (key, label, sub, checked, onAct) {
        return clickable(function () { onAct(!checked); }, { key: key, "data-fb": key, "data-on": checked ? "1" : "0", focusClassName: "shelves-rowfocus", style: advRowStyle },
          [advLabelCol(label, sub), updSwitch(checked)]);
      };
      // Numeric stepper: the original two focusable − / + buttons (A activates
      // each), wrapped in a `flow-children:"horizontal"` Focusable so the gamepad
      // moves BETWEEN them laterally instead of vertically. Subtext under the label.
      const advStepRow = function (key, label, sub, val) {
        const cur = Number(val) || 0;
        const stepBtn = function (sym, delta) {
          return clickable(function () { applyCfg(key, Math.max(0, cur + delta)); }, { key: key + sym, "data-fb": key + sym, style: { flex: "0 0 auto", width: "30px", height: "28px", borderRadius: "4px", background: "rgba(255,255,255,0.14)", color: "#fff", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "16px", lineHeight: "1" } }, [sym]);
        };
        const groupKids = [stepBtn("−", -5), h("span", { key: "v", style: { flex: "0 0 auto", minWidth: "34px", textAlign: "center", fontFamily: "monospace" } }, String(cur)), stepBtn("+", 5)];
        const groupStyle = { display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto" };
        const group = focusableComp
          ? h(focusableComp, { key: "st", "flow-children": "horizontal", style: groupStyle }, groupKids)
          : h("div", { key: "st", style: groupStyle }, groupKids);
        return h("div", { key: key, style: { display: "flex", alignItems: "center", gap: "8px", minHeight: "40px", boxSizing: "border-box", padding: "6px 16px", fontSize: "13px" } }, [advLabelCol(label, sub), group]);
      };
      // Read-only status rows: focusable (so the gamepad can walk them), whole-row
      // highlight, label left + value right for a clean two-column read.
      const advRoRow = function (key, label, val) {
        const body = [
          h("span", { key: "l", style: { flex: "0 0 auto", color: "rgba(255,255,255,0.72)" } }, label),
          h("span", { key: "v", style: { flex: "1 1 auto", textAlign: "right", fontFamily: "monospace", wordBreak: "break-all", color: "rgba(255,255,255,0.92)" } }, String(val)),
        ];
        const st = { display: "flex", alignItems: "center", gap: "10px", minHeight: "36px", boxSizing: "border-box", padding: "6px 16px", fontSize: "12px" };
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
        const sections = [];
        /* Updates split by responsibility:
           - Deck Shelves bundle updates remain delegated to the loader while the
             renderer is co-owned and the host does not host that bundle.
           - ShelvesHub self-update remains available even in coexistence, so the
             daemon can update itself independently of the plugin's owner. */
        let upd, updCount;
        if (coexist) {
          upd = [
            h("div", { key: "cx", "data-fb": "updates-note", style: { padding: "8px 16px", fontSize: "12px", color: "rgba(255,255,255,0.6)" } }, I18N.t("updates_managed_elsewhere")),
          ];
          upd = upd.concat(updRows(["auto_update", "auto_update_hub", "hub_prerelease"]));
          upd.push(actionRow("update", "update", "action_update_hub", "selfUpdate"));
          updCount = upd.length;
        } else {
          upd = updRows().slice();
          upd.push(actionRow("download", "download", "action_download", "populateBundle"));
          upd.push(actionRow("update", "update", "action_update_hub", "selfUpdate"));
          updCount = upd.length;
        }
        sections.push(h(HubCollapsible, { key: "sec-upd", id: "sec-updates", title: I18N.t("sec_updates"), count: updCount, initialOpen: true }, upd));
        const trouble = [actionRow("logs", "logs", "action_logs", "getLogs")];
        if (rc) {
          trouble.push(advToggleRow("adv-pause", I18N.t("adv_disable_hub"), I18N.t("adv_disable_hub_sub"), rc.paused === true, applyPaused));
          if (rc.paused === true) trouble.push(h("div", { key: "pn", style: { padding: "2px 16px 6px", fontSize: "12px", color: "#ffcf6b" } }, I18N.t("adv_paused")));
        }
        sections.push(h(HubCollapsible, { key: "sec-tr", id: "sec-troubleshooting", title: I18N.t("adv_sec_troubleshooting"), count: rc ? 2 : 1 }, trouble));
        if (rc) {
          // Only genuine operational config here — `native_qam` (default on; a
          // recovery knob left to the config file/env) and `prerelease` (already
          // covered by the Updates section's pre-release channels) are intentionally
          // NOT surfaced. The coexist-only settings (force_owner, owner_settle_secs)
          // are shown only when another loader is ACTUALLY present — they are inert
          // as a sole host (no loader to force ownership from or settle behind), so
          // they stay hidden on a pure sole platform AND on a loader-capable one
          // whose loader is not currently running.
          const conf = [];
          // Ownership knobs are meaningful only where a plugin loader can share
          // the renderer (Linux/SteamOS). On a pure sole host they are inert, so
          // they stay in the read-only Status readout below instead of as toggles.
          if (rc.loader_possible) {
            conf.push(advToggleRow("cfg-force_owner", I18N.t("cfg_force_owner"), I18N.t("cfg_force_owner_sub"), rc.force_owner === true, function (v) { applyCfg("force_owner", v); }));
            conf.push(advStepRow("owner_settle_secs", I18N.t("cfg_owner_settle"), I18N.t("cfg_owner_settle_sub"), rc.owner_settle_secs));
          }
          conf.push(advToggleRow("cfg-boot_movie", I18N.t("cfg_boot_movie"), I18N.t("cfg_boot_movie_sub"), rc.boot_movie === true, applyBootMovie));
          // Experimental: inject in the plain desktop client too (default off →
          // gamepad / Big Picture only). Only meaningful where a desktop client
          // exists (macOS / Windows), so hide it on the Deck's Gaming Mode.
          if (!rc.loader_possible) {
            conf.push(advToggleRow("cfg-desktop_ui", I18N.t("cfg_desktop_ui"), I18N.t("cfg_desktop_ui_sub"), rc.desktop_ui === true, function (v) { applyCfg("desktop_ui", v); }));
          }
          conf.push(advStepRow("interval_secs", I18N.t("cfg_interval"), I18N.t("cfg_interval_sub"), rc.interval_secs));
          const confCount = conf.length;
          if (rcDirty) conf.push(h("div", { key: "rn", style: { padding: "6px 16px 2px", fontSize: "12px", color: "#ffcf6b" } }, I18N.t("adv_restart_note")));
          sections.push(h(HubCollapsible, { key: "sec-cf", id: "sec-config", title: I18N.t("adv_sec_config"), count: confCount }, conf));
          const ownerMode = COOP ? "cooperative" : (coexist ? "coexist" : "sole");
          const status = [
            advRoRow("mode", I18N.t("cfg_mode"), ownerMode),
          ];
          // On a pure sole host the ownership toggle is hidden above; surface its
          // current value here so the state stays visible.
          if (!rc.loader_possible) status.push(advRoRow("force", I18N.t("cfg_force_owner"), rc.force_owner ? "on" : "off"));
          status.push(
            advRoRow("cef", I18N.t("cfg_cef"), (rc.cef_host || "") + ":" + (rc.cef_port || "")),
            advRoRow("rpc", I18N.t("cfg_rpc"), rc.rpc_addr || ""),
            advRoRow("recover", I18N.t("cfg_recover_cmd"), rc.recover_cmd == null ? "—" : rc.recover_cmd),
            advRoRow("bundle", I18N.t("cfg_bundle"), rc.bundle_path || ""),
            advRoRow("backend", I18N.t("cfg_backend"), rc.backend ? "on" : "off"),
            advRoRow("boot", I18N.t("cfg_boot_movie"), rc.boot_movie ? "on" : "off"),
            advRoRow("version", I18N.t("cfg_version"), rc.version || "")
          );
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
        const optimistic = {}; for (const k in uc) optimistic[k] = uc[k]; optimistic[key] = next;
        setCfg(optimistic); setBusy("upd");
        const method = key === "auto_update" ? "setAutoUpdate" : "setUpdatePref";
        const args = key === "auto_update" ? next : { key: key, value: next };
        hostRpc(method, args).then(function (r) {
          setBusy(null);
          if (r && r.ok && r.result && typeof r.result === "object") setCfg(r.result);
        }, function () { setBusy(null); setCfg(uc); });
      }
      /* The nested update hierarchy: master → { hub, plugin } → each a beta
         channel. A child is HIDDEN (not disabled) while any ancestor switch is
         off — the moment the parent turns on the child appears. `visible` encodes
         the full ancestor chain, so filtering by it hides whole sub-trees at once. */
      const UPD_ROWS = [
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
      /* Render each level with the SAME flat, transparent, hand-drawn row as the
         Configuration/Troubleshooting toggles (`advToggleRow`) so the whole panel
         reads as one inset list — the boxed / native variants sat edge-to-edge and
         looked out of place. Depth indents (per level) convey the nested hierarchy;
         rows whose ancestor is off are not rendered. one flat list. */
      function updRows(filterKeys) {
        return UPD_ROWS.filter(function (rw) {
          if (!filterKeys) return rw.visible();
          return filterKeys.indexOf(rw.key) !== -1 && rw.visible();
        }).map(function (rw) {
          const checked = uc[rw.key] === true;
          const rowStyle = { display: "flex", alignItems: "center", gap: "10px", width: "100%", boxSizing: "border-box", padding: "6px 16px", paddingLeft: (16 + rw.depth * 20) + "px", minHeight: "40px", border: "none", background: "transparent", color: "#fff", cursor: busy ? "default" : "pointer", fontSize: "13px" };
          return clickable(function () { if (!busy) applyPref(rw.key, !checked); }, { key: rw.key, "data-fb": "upd-" + rw.key, "data-on": checked ? "1" : "0", focusClassName: "shelves-rowfocus", style: rowStyle },
            [h("span", { key: "t", style: { flex: "1 1 auto", textAlign: "left" } }, I18N.t(rw.labelKey)), updSwitch(checked)]);
        });
      }

      /* ── Log viewer ── merged daemon + runtime lines (getLogs), each parsed
         from `[LEVEL] [ts] [scope] msg` into a badged row (level colour + scope),
         so it reads like the plugin's Advanced → Logs. Newest first, scrollable.
         Rendered inline below the hub actions (an expandable panel that keeps the
         ShelvesHub screen visible); the gamepad reaches it in the normal nav flow. */
      function buildLogView() {
        const parseLine = function (line) {
          const m = /^\[(\w+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+([\s\S]*)$/.exec(String(line));
          return m ? { level: m[1].toUpperCase(), ts: m[2], scope: m[3], msg: m[4] }
                   : { level: "INFO", ts: "", scope: "", msg: String(line) };
        };
        // Each row is a Focusable item (gamepad-navigable, like the plugin's
        // Advanced → Logs list), falling back to a plain <div> before Focusable
        // is discovered. Steam moves focus row-to-row and scrolls the container.
        const logRow = function (line, i) {
          const p = parseLine(line);
          const lb = LOG_LEVEL_BG[p.level] || "#64748b";
          const sc = LOG_SCOPE_COLOR[p.scope] || "rgba(255,255,255,0.14)";
          const rowStyle = { display: "flex", gap: "8px", alignItems: "baseline", padding: "7px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: "12px", lineHeight: "1.5", fontFamily: "monospace" };
          const kids = [
            h("span", { key: "lv", style: { flex: "0 0 auto", background: lb, color: "#04121f", padding: "0 4px", borderRadius: "2px", fontWeight: "800" } }, p.level),
            p.scope ? h("span", { key: "sc", style: { flex: "0 0 auto", background: sc, color: "#04121f", padding: "0 4px", borderRadius: "2px", fontWeight: "700" } }, p.scope) : null,
            h("span", { key: "ms", style: { flex: "1 1 auto", color: "rgba(255,255,255,0.88)", wordBreak: "break-word", whiteSpace: "pre-wrap" } }, p.msg),
            p.ts ? h("span", { key: "ts", style: { flex: "0 0 auto", color: "rgba(255,255,255,0.4)" } }, p.ts.slice(11)) : null,
          ];
          /* A Focusable only becomes a gamepad focus STOP when it has an activate
             handler — the plugin's log rows carry one too. Without it Steam skips
             the row and focus never lands in the list (the "can't focus" bug). The
             handler is a no-op; the row is a read-only line. */
          const props = focusableComp
            ? { key: "l" + i, focusClassName: "shelves-rowfocus", style: rowStyle, "data-fb": "log-row", onActivate: function () {}, onOKButton: function () {} }
            : { key: "l" + i, style: rowStyle, "data-fb": "log-row" };
          return React.createElement.apply(React, [focusableComp || "div", props].concat(kids));
        };
        const rows = logs.length
          ? logs.slice().reverse().map(logRow)
          : [h("div", { key: "empty", style: { opacity: 0.6, fontSize: "13px", padding: "8px 16px" } }, I18N.t("logs_empty"))];
        // Header controls in a HORIZONTAL Focusable row (back / refresh / clear) so
        // the gamepad walks them left-to-right, not top-to-bottom.
        const ctrlBtn = function (key, onAct, label, extraStyle, title) {
          const base = { display: "inline-flex", alignItems: "center", justifyContent: "center", height: "32px", padding: "0 10px", borderRadius: "4px", background: "rgba(255,255,255,0.08)", cursor: "pointer", border: "none", color: "#fff", fontSize: "12px" };
          if (extraStyle) for (const s in extraStyle) base[s] = extraStyle[s];
          const props = { key: key, "data-fb": "logs-" + key, focusClassName: "shelves-gpfocus", style: base };
          if (title) { props.title = title; props["aria-label"] = title; }
          return clickable(onAct, props, label);
        };
        // Icon-only square controls (back / refresh / clear), each with an
        // accessible label — no text captions, matching the flat icon style.
        const iconBtnStyle = { width: "36px", padding: "0" };
        const ctrls = [
          ctrlBtn("back", backToHub, [fbIcon("back")], iconBtnStyle, I18N.t("action_back")),
          h("div", { key: "ttl", style: { fontSize: "16px", fontWeight: "700", flex: "1 1 auto" } }, I18N.t("logs_title")),
          ctrlBtn("refresh", function () { viewLogs(); }, [fbIcon("refresh")], iconBtnStyle, I18N.t("logs_refresh")),
          ctrlBtn("clear", function () { clearLogs(); }, [fbIcon("trash")], iconBtnStyle, I18N.t("logs_clear")),
        ];
        const header = React.createElement.apply(React, [
          focusableComp || "div",
          focusableComp
            ? { "flow-children": "horizontal", style: { display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto", padding: "0 16px 8px" } }
            : { style: { display: "flex", alignItems: "center", gap: "8px", padding: "0 16px 8px" } },
        ].concat(ctrls));
        /* Inline, expandable list kept BELOW the hub actions (which stay visible —
           the ShelvesHub screen is preserved). A vertical Focusable so the gamepad
           walks the rows in the normal flow (no click needed to focus) and B
           (onButtonDown) collapses it back. Capped height with its own scroll so it
           never grows the panel unbounded. */
        const listProps = focusableComp
          ? { "flow-children": "vertical", onButtonDown: makeBackButtonDown(backToHub), onCancel: backToHub, style: { maxHeight: "300px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "1px" } }
          : { style: { maxHeight: "300px", overflowY: "auto" } };
        const list = React.createElement.apply(React, [focusableComp || "div", listProps].concat(rows));
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
      const TF = UI.ToggleField;
      const useNative = nativeUiOn() && !!TF;
      const titleRow = onBack
        ? h("div", { key: "title", style: { display: "flex", alignItems: "center", gap: "8px", padding: "4px 16px 8px" } },
            clickable(onBack, { "data-fb": "back", title: I18N.t("action_back"), focusClassName: "shelves-gpfocus", style: { flex: "0 0 auto", width: "28px", height: "28px", border: "none", borderRadius: "4px", background: "rgba(255,255,255,0.08)", color: "#fff", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" } }, [fbIcon("back")]),
            h("div", { style: { fontSize: "18px", fontWeight: "700" } }, I18N.t("hub_title")))
        : h("div", { key: "title", style: { fontSize: "18px", fontWeight: "700", padding: "6px 16px 4px" } }, I18N.t("hub_title"));
      let body = [titleRow];
      if (rcDirty) body.push(restartBanner());
      const notice = hubUpdateNotice();
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
      const hub = React.useState(false);
      const showHub = hub[0], setShowHub = hub[1];
      const s = firstSpec();
      let body;
      // No registered panel → the hub view IS the content (the fallback).
      if (!s) body = h(FallbackPanel, null);
      // Hub view opened from the plugin editor → show it with a back button.
      else if (showHub) body = h(FallbackPanel, { onBack: function () { setShowHub(false); } });
      // Plugin editor + a ShelvesHub button pinned at the end that opens the hub
      // view (the host's own options, reachable while Deck Shelves is loaded).
      else {
        const openHub = function () { setShowHub(true); };
        const hubBtn = (nativeUiOn() && UI.DialogButton)
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
        // (useIsActiveQamTab). The QAM panel does the scrolling.
        // Inset the ShelvesHub button so it aligns with the plugin's own rows and
        // our hub-screen items (which sit inside the section's 14px padding), rather
        // than sitting flush against the QAM edge.
        body = h("div", null, contentEl(s), h("div", { style: { padding: "0 14px" } }, hubBtn));
      }
      const inner = ErrorBoundary ? h(ErrorBoundary, null, body) : body;
      // Focus ring: Steam applies `.gpfocus` to the focused native control but draws
      // NO ring for our injected panel (it sits outside Steam's own FocusRing
      // ancestor). We render the ring CSS as part of the panel so it lands in the
      // QAM document (NOT SharedJSContext, where a head-injected <style> would go
      // and never reach these nodes), scoped to `.shelves-panel`.
      // Ring ONLY buttons (DialogButton lacks a native focus visual in our injected
      // panel) and our own plain clickables (.shelves-gpfocus). Toggles, collapsible
      // titles and other native controls already get Steam's own row highlight
      // (a background, not a ring) — ringing them too looks doubled-up/odd.
      let ringCss =
        ".shelves-panel .DialogButton.gpfocus,.shelves-panel .shelves-gpfocus{" +
        "box-shadow:0 0 0 2px rgba(255,255,255,.95),0 0 12px 2px rgba(90,160,255,.6)!important;" +
        "border-radius:4px;}" +
        // Whole-row focus highlight (a background, like the plugin's QAM rows) for
        // section headers and Advanced rows — not the button ring above.
        ".shelves-panel .shelves-rowfocus{background:rgba(255,255,255,.1)!important;}";
      /* Our edge-to-edge toggle row's Field has 0 horizontal padding, so its label/
         switch would touch the QAM edges. Pad the Field's CONTENT (not the wrapper):
         the highlight/background still reaches the QAM edge, only the content insets.
         The Field class is Steam's own gamepadDialog CSS class — discovered from the
         webpack in sole mode (no loader), or borrowed from the loader in coexist. */
      try {
        let _gpdCls = null;
        try {
          _gpdCls = Steam.findModule(function (e) {
            return e && typeof e === "object" && typeof e.Field === "string" &&
              typeof e.GamepadDialogContent === "string" && typeof e.StandardPadding === "string";
          });
        } catch (e) {}
        const _fieldCls = (_gpdCls && _gpdCls.Field) ||
          (window.DFL && window.DFL.gamepadDialogClasses && window.DFL.gamepadDialogClasses.Field) || "";
        if (_fieldCls) ringCss += ".shelves-panel .shelves-toggle-row ." + _fieldCls +
          "{padding-left:14px!important;padding-right:14px!important;}";
      } catch (e) {}
      const styleEl = h("style", { "data-shelves": "ring" }, ringCss);
      // Wrap the panel in Steam's Focusable so it joins gamepad-focus navigation
      // (the mirrored editor's controls and ours), the way a loader wraps its
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
    const DEFAULT_TAB_KEY = 900;
    const NATIVE_TAB_KEY = (function () {
      try {
        if ("__SHELVES_QAM_KEY__" in window && typeof window.__SHELVES_QAM_KEY__ === "number") return window.__SHELVES_QAM_KEY__;
      } catch (e) {}
      return DEFAULT_TAB_KEY;
    })();
    const NATIVE_TAB_NAME = "ShelvesHub";
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
        const e = tabEnum();
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

    /* Position: sit right AFTER Steam's Performance tab, so we are always just
       below Performance and above any lower tab (other hosts' tabs included,
       which append at the end). Configurable: set `window.__SHELVES_QAM_AFTER__`
       to another QuickAccessTab key, or to null to append at the very end. */
    const NATIVE_TAB_AFTER = 5; // right AFTER Steam's Performance tab (QuickAccessTab.Perf) and thus before another host's tab (those append at the end). With the user's hidden tabs this reads as "just before the loader's tab". Override with window.__SHELVES_QAM_AFTER__.
    function insertAfterKey() {
      try { if ("__SHELVES_QAM_AFTER__" in window) return window.__SHELVES_QAM_AFTER__; } catch (e) {}
      return NATIVE_TAB_AFTER;
    }
    let cachedTab = null;
    function pushTab(tabs) {
      // Idempotent: if our tab is already in this list, only refresh its
      // visibility to track the menu's open/closed state — never insert twice.
      for (let j = 0; j < tabs.length; j++) {
        if (tabs[j] && tabs[j].key === NATIVE_TAB_KEY) {
          if (typeof tabs[j].qAMVisibilitySetter === "function") { try { tabs[j].qAMVisibilitySetter(lastVisible); } catch (e) {} }
          else { tabs[j].initialVisibility = lastVisible; }
          return;
        }
      }
      /* Reuse ONE tab object (and its panel/icon elements) across renders. The
         list is rebuilt fresh on every QAM render, so building a NEW tab each time
         hands Steam a new panel element every render — remounting the mirrored
         editor, resetting toggles/side panel, and preventing gamepad focus from
         settling. A loader adds its tab once; we keep ours stable the same way. */
      if (!cachedTab) cachedTab = buildTab();
      const tab = cachedTab;
      tab.initialVisibility = lastVisible;
      // Position: right after Steam's Performance tab, so we sit ahead of any
      // tab that is appended at the end of the list (later additions land last).
      const after = insertAfterKey(); let at = tabs.length;
      if (after != null) {
        for (let i = 0; i < tabs.length; i++) { if (tabs[i] && tabs[i].key === after) { at = i + 1; break; } }
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
    const wrapCache = typeof WeakMap === "function" ? new WeakMap() : null;
    function tabWrapper(innerFn) {
      const w = function () {
        const out = innerFn.apply(this, arguments);
        try {
          const node = findInReactTree(out, function (x) { return x && x.props && Array.isArray(x.props.tabs); });
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
        for (const k in fn) { if (k !== "__shelvesTabWrap" && /patch|wrapped/i.test(k)) return true; }
        const inner = fn.type;
        if (inner && typeof inner === "object") { for (const k2 in inner) { if (k2 !== "__shelvesTabWrap" && /patch|wrapped/i.test(k2)) return true; } }
      } catch (e) {}
      return false;
    }
    function injectTabs(ret) {
      // Fast path: tabs already in this output.
      const direct = findInReactTree(ret, function (x) { return x && x.props && Array.isArray(x.props.tabs); });
      if (direct) { pushTab(direct.props.tabs); return; }
      // Otherwise wrap the component whose output produces the tab list.
      const host = findInReactTree(ret, function (n) { return n && n.props && n.props.onFocusNavDeactivated && n.type; });
      if (!host) return;
      const orig = host.type;
      if (orig.__shelvesTabWrap || (orig.type && orig.type.__shelvesTabWrap)) return; // already ours
      // Chain our tab-append after whatever already wraps this component (another
      // host may have wrapped it first): on render, its wrapper adds its tab(s),
      // then ours adds ours. The earlier React #31 was NOT this double-wrap — it
      // was the heavy UI discovery blocking the main thread (now skipped in
      // coexistence), so chaining here is safe and additive. `foreignWrapped`
      // stays available for diagnostics.
      void foreignWrapped;
      if (wrapCache && wrapCache.has(orig)) { host.type = wrapCache.get(orig); return; }
      let wrapped;
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
    // (on-device 2026-07-23). We only
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
        const mod = Steam.findModuleByExport(function (e) {
          try { return e && e.type && typeof e.type === "function" && e.type.toString().indexOf("QuickAccessMenuBrowserView") >= 0; } catch (_) { return false; }
        });
        if (!mod) return false; // consumer chunk not loaded yet — retry
        const bv = Object.values(mod).find(function (e) {
          try { return e && e.type && e.type.toString && e.type.toString().indexOf("QuickAccessMenuBrowserView") >= 0; } catch (_) { return false; }
        });
        const embedded = Object.values(mod).find(function (e) {
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
        const handler = function (args, ret) {
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
        let doRepoint = true;
        try { if (window.__SHELVES_FIBER_REPOINT__ === false) doRepoint = false; } catch (e) {}
        if (doRepoint) { patchMountedConsumer(bv, embedded); }
        else { log("QAM native: mounted re-point OFF (opt out via __SHELVES_FIBER_REPOINT__=false)."); }
      } catch (e) {
        tripClear();
        logWarn("QAM", "installPatch failed: " + (e && e.message));
      }
      return patched;
    }

    /* Reach the live fiber for an already-mounted consumer and re-point its
       `type` to the patched inner function. Scoped to that one fiber node (and
       its alternate), so nothing shared is mutated. No-op if the menu has not
       mounted yet (the wrap above covers the first mount then). */
    function patchMountedConsumer(bv, embedded) {
      try {
        const root = getReactRoot(document.getElementById("root"));
        if (!root) return;
        const node = findInReactTree(root, function (n) {
          return n && (n.elementType === bv || (embedded && n.elementType === embedded));
        });
        if (node && node.elementType && node.elementType.type) {
          /* Re-point only prepares the fiber; the actual render (and any collapse
             risk) happens later through the handler, which arms itself. Arming here
             would leave a lingering arm when the QAM is closed (no render follows),
             re-creating the false-trip. So do NOT arm here. */
          node.type = node.elementType.type;
          if (node.alternate) node.alternate.type = node.type;
          log("QAM native: re-pointed already-mounted consumer.");
        }
      } catch (e) { log("QAM mounted re-point skipped:", e && e.message); }
    }

    /* The builder's chunk loads at some point during Steam boot and the QAM
       mounts right after — so when this runtime evaluates early (preload
       path), poll until the builder appears. The append is idempotent and
       non-destructive, so retrying is safe; if the QAM mounts before we won
       the race, the tab simply waits for the next Steam UI boot. */
    let patchAttempts = 0;
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
