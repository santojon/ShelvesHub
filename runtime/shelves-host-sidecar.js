/* runtime/shelves-host-sidecar.js — the hub's management/log sidecar: a panel that widens the
   Quick Access menu (the compositor message Steam's own friends list uses) and shows the host's
   log stream beside the ShelvesHub view; plus the notification-center rows the hub view and
   Steam's Notifications tab share. Assembled after shelves-host-api.js (shared closure). */

  // The hub view's inline icons (tintable, 16 px) — self-contained, no dependency on Steam's UI.
  const FALLBACK_ICONS = {
    download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M8 11l4 4 4-4"/><path d="M5 20h14"/></svg>',
    update: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/></svg>',
    logs: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/></svg>',
    auto: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    bell: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
    trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>',
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
  // A gamepad-focusable clickable: Steam's Focusable (onActivate fires on A and pointer) once
  // discovered, else a plain <button>. Focusable adds the native focus ring via focusClassName
  // ("shelves-gpfocus"); the CSS is rendered INTO the panel (PanelSlot) so it reaches the QAM doc.
  function clickable(onAct, extra, kids) {
    const props = focusableComp
      ? { onActivate: onAct, focusClassName: "shelves-gpfocus" }
      : { onClick: onAct };
    if (extra) for (const k in extra) props[k] = extra[k];
    return React.createElement.apply(React, [focusableComp || "button", props].concat(kids || []));
  }
  // Compact relative age from an elapsed-ms value (null when unknown).
  function agoText(ms) {
    if (typeof ms !== "number" || ms < 0) return null;
    if (ms < 60000) return I18N.t("upd_just_now");
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return mins + "m";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h";
    return Math.floor(hrs / 24) + "d";
  }
  function isReactElement(o) { return !!(o && typeof o === "object" && o.$$typeof); }
  // The sender's mark on a notification-center row: the element it was sent with, an SVG
  // string, else the default mark by source — the same marks the Steam toasts carry.
  function notifLogo(n) {
    const box = { flex: "0 0 auto", width: "36px", height: "36px", display: "inline-flex", alignItems: "center", justifyContent: "center", overflow: "hidden" };
    if (isReactElement(n.logo)) return h("span", { key: "lg", style: box }, n.logo);
    const svg = (typeof n.logo === "string" && n.logo.indexOf("<svg") === 0) ? n.logo : logoSvg(n.source);
    return h("span", { key: "lg", style: box, dangerouslySetInnerHTML: { __html: svg } });
  }
  // One notification-center entry: the sender's mark, the per-type icon + title (bold until
  // read), body, age — a focusable read-only row.
  function notifRow(n, key) {
    const titleKids = [h("span", { key: "ti", style: { fontWeight: n.read ? "400" : "700" } }, n.title)];
    if (isReactElement(n.icon)) titleKids.unshift(h("span", { key: "ic", style: { flex: "0 0 auto", width: "16px", height: "16px", display: "inline-flex", alignItems: "center" } }, n.icon));
    const body = [
      notifLogo(n),
      h("div", { key: "t", style: { flex: "1 1 auto", minWidth: "0", display: "flex", flexDirection: "column", gap: "1px" } }, [
        h("div", { key: "tr", style: { display: "flex", alignItems: "center", gap: "6px" } }, titleKids),
        n.body ? h("span", { key: "bd", style: { fontSize: "11px", color: "rgba(255,255,255,0.55)", lineHeight: "1.3" } }, n.body) : null,
      ]),
      h("span", { key: "ago", style: { flex: "0 0 auto", fontSize: "11px", color: "rgba(255,255,255,0.4)" } }, agoText(Date.now() - n.ts) || ""),
    ];
    const st = { display: "flex", alignItems: "center", gap: "10px", minHeight: "40px", boxSizing: "border-box", padding: "6px 16px", fontSize: "13px" };
    return focusableComp
      ? h(focusableComp, { key: key, "data-fb": "notif-row", onActivate: function () {}, focusClassName: "shelves-rowfocus", style: st }, body)
      : h("div", { key: key, "data-fb": "notif-row", style: st }, body);
  }

  const Sidecar = (function () {
    const MSG_ORIGIN = "https://steamloopback.host";
    /* Geometry defaults (overridden by live measurement): fixed to the menu's viewport, right
       of the hub view, stretched to the menu's panel edges. Fixed, not absolute, so the panel
       neither scrolls along when the gamepad focus scrolls the hub view's column under it nor
       gets clipped by the tab's own 300 px content panel. */
    const CSS =
      ".shelves-sidecar{position:fixed;left:348px;top:14px;width:503px;height:440px;box-sizing:border-box;" +
      "z-index:5;display:flex;flex-direction:column;background:transparent;" +
      "border-left:1px solid rgba(255,255,255,.06);}" +
      ".shelves-sidecar-inner{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;}";
    // The QAM document's opener owns the compositor (what the friends list posts
    // to); no opener (harness page, plain desktop window) = a no-op.
    function compositor(doc, expanded) {
      try {
        const win = doc && doc.defaultView;
        const opener = win && win.opener;
        if (!opener || typeof opener.postMessage !== "function") return false;
        opener.postMessage({ message: expanded ? "QamFriendsExpanded" : "QamFriendsHidden" }, MSG_ORIGIN);
        return true;
      } catch (e) { return false; }
    }
    function navRoot(el) {
      try {
        return el.ownerDocument.defaultView.opener.SteamUIStore.NavigationManager.m_ActiveContext.m_LastActiveNavTree.m_Root;
      } catch (e) { return null; }
    }
    function findNavNode(node, target) {
      if (!node) return null;
      if (node.m_element === target) return node;
      const kids = node.m_rgChildren || [];
      for (let i = 0; i < kids.length; i++) {
        const r = findNavNode(kids[i], target);
        if (r) return r;
      }
      return null;
    }
    // Move gamepad focus onto an element through Steam's nav tree (a DOM focus()
    // is not a gamepad focus). False when the tree isn't reachable (harness).
    function takeFocus(el) {
      try {
        const node = findNavNode(navRoot(el), el);
        return !!(node && typeof node.BTakeFocus === "function" && node.BTakeFocus(0));
      } catch (e) { return false; }
    }
    /* Size from the live QAM, like the plugin's own sidecar: the hub view is pinned to the
       plugin's main-column width while the panel is open, and the panel stretches from its
       right edge to the edges of the menu's dark tab panel — the element that widens with
       the menu (the tab's content panel does not): found by its class as the plugin finds
       it, else as the first ancestor wider than the content panel, else the viewport. */
    const MAIN_WIDTH_PX = 300;
    // The box the panel is anchored to: the tab's content panel (its box stays put when its
    // content scrolls), else the hub root itself (harness, plain pages).
    function anchorRect(side, root) {
      const content = side.closest('[id^="quickaccess_content_"]') || root;
      return content ? content.getBoundingClientRect() : { left: 0, top: 0 };
    }
    function menuPanel(side, doc) {
      const known = doc.querySelector("._2BB6uf--jFaAmdnwLOqMU7");
      if (known) return known;
      const content = side.closest('[id^="quickaccess_content_"]');
      const contentWidth = content ? content.getBoundingClientRect().width : 0;
      let el = content && content.parentElement;
      while (el && el !== doc.body) {
        if (el.getBoundingClientRect().width > contentWidth + 40) return el;
        el = el.parentElement;
      }
      return null;
    }
    function measure(side) {
      const doc = side.ownerDocument, win = doc.defaultView || window;
      const root = side.parentElement;
      if (root) root.style.width = MAIN_WIDTH_PX + "px";
      const ar = anchorRect(side, root);
      const left = Math.round(ar.left + MAIN_WIDTH_PX), top = Math.round(ar.top);
      const panel = menuPanel(side, doc);
      const pr = panel ? panel.getBoundingClientRect() : null;
      const right = pr ? pr.right : win.innerWidth;
      const bottom = pr ? pr.bottom : win.innerHeight;
      side.style.left = left + "px";
      side.style.top = top + "px";
      side.style.width = Math.max(280, Math.round(right - left)) + "px";
      side.style.height = Math.max(320, Math.round(bottom - top)) + "px";
    }
    function sideOf(inner) { return inner && inner.closest ? inner.closest(".shelves-sidecar") : null; }
    // Move gamepad focus into the panel: the active tab first, else the first element Steam's
    // nav tree knows (plain wrappers carry data-fb too and must be skipped).
    function focusInto(side) {
      const active = side.querySelector('[data-fb^="sidecar-tab-"][data-active="1"]');
      if (active && takeFocus(active)) return true;
      const all = side.querySelectorAll("[data-fb]");
      for (let i = 0; i < all.length; i++) if (takeFocus(all[i])) return true;
      return false;
    }
    /* Measure on mount, on viewport resize and shortly after (QAM layout settling),
       then move gamepad focus into the panel (one retry, for a list still rendering).
       Every observer and timer is torn down with the panel, and the pinned root width
       is released. */
    function useGeometry(ref) {
      React.useEffect(function () {
        const side = sideOf(ref.current);
        if (!side) return undefined;
        const doc = side.ownerDocument, win = doc.defaultView || window;
        const run = function () { try { measure(side); } catch (e) {} };
        run();
        const ro = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(run) : null;
        if (ro) ro.observe(doc.documentElement);
        win.addEventListener("resize", run);
        const t1 = win.setTimeout(run, 60), t2 = win.setTimeout(run, 240);
        let t4 = 0;
        const t3 = win.setTimeout(function () {
          if (!focusInto(side)) t4 = win.setTimeout(function () { focusInto(side); }, 300);
        }, 90);
        const root = side.parentElement;
        return function () {
          if (ro) ro.disconnect();
          win.removeEventListener("resize", run);
          win.clearTimeout(t1); win.clearTimeout(t2); win.clearTimeout(t3); win.clearTimeout(t4);
          if (root) root.style.width = "";
        };
      }, []);
    }
    /* Widen on mount, narrow on unmount; collapse when the QAM document hides (the
       menu closed, or Steam overlaid it), so a reopened menu never comes back wide
       and empty. Listeners are removed with the panel. */
    function useCompositor(ref, onClose) {
      React.useEffect(function () {
        const side = sideOf(ref.current);
        const doc = side ? side.ownerDocument : document;
        const win = doc.defaultView || window;
        compositor(doc, true);
        const onVis = function () { if (doc.hidden) onClose(); };
        const onHide = function () { onClose(); };
        doc.addEventListener("visibilitychange", onVis);
        win.addEventListener("pagehide", onHide);
        return function () {
          doc.removeEventListener("visibilitychange", onVis);
          win.removeEventListener("pagehide", onHide);
          compositor(doc, false);
        };
      }, []);
    }
    // The panel: a Focusable column (B closes it, via the caller's absorbing
    // onButtonDown) holding whatever the hub view puts beside itself.
    function Panel(props) {
      const ref = React.useRef(null);
      useGeometry(ref);
      useCompositor(ref, props.onClose);
      const inner = h("div", { key: "in", ref: ref, className: "shelves-sidecar-inner" }, props.children);
      const base = { className: "shelves-sidecar", "data-fb": "sidecar" };
      if (!focusableComp) return h("div", base, inner);
      base.noFocusRing = true;
      base.onCancelButton = props.onClose;
      base.onButtonDown = props.onButtonDown;
      return h(focusableComp, base, inner);
    }
    return { Panel: Panel, css: CSS, compositor: compositor, takeFocus: takeFocus };
  })();

  /* ── Sidecar tabs (Notifications | Status | Logs), the title icons that open them, and the two
     ways to open the panel without a pointer: the plugin's own D-pad gesture and the keyboard. ── */
  const SIDE_TAB_LOGS = "logs", SIDE_TAB_NOTIF = "notif", SIDE_TAB_STATUS = "status", SIDE_TAB_ABOUT = "about";
  const BADGE_STYLE = { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "16px", height: "16px", padding: "0 5px", borderRadius: "8px", background: "#1a9fff", color: "#fff", fontSize: "10px", fontWeight: "700" };
  // One tab header: the active one is bright with an accent underline; a count badge for unread.
  function sidecarTab(id, label, active, onPick, badge) {
    const st = { display: "inline-flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 12px", borderRadius: "4px", border: "none", cursor: "pointer", fontSize: "13px", fontWeight: active ? "700" : "500", color: active ? "#fff" : "rgba(255,255,255,0.6)", background: active ? "rgba(255,255,255,0.14)" : "transparent", boxShadow: active ? "inset 0 -2px 0 #1a9fff" : "none" };
    const kids = [h("span", { key: "t" }, label)];
    if (badge > 0) kids.push(h("span", { key: "b", style: BADGE_STYLE }, String(badge)));
    return clickable(onPick, { key: "tab-" + id, "data-fb": "sidecar-tab-" + id, "data-active": active ? "1" : "0", focusClassName: "shelves-gpfocus", style: st }, kids);
  }
  // A small icon button beside the hub title that opens the panel on one tab (badge = unread).
  function titleIconButton(id, iconKey, title, onPick, badge) {
    const kids = [fbIcon(iconKey)];
    if (badge > 0) kids.push(h("span", { key: "b", style: BADGE_STYLE }, String(badge)));
    const st = { flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: "4px", height: "28px", padding: "0 6px", border: "none", borderRadius: "4px", background: "rgba(255,255,255,0.08)", color: "#fff", cursor: "pointer" };
    return clickable(onPick, { key: id, "data-fb": id, title: title, "aria-label": title, focusClassName: "shelves-gpfocus", style: st }, kids);
  }
  // The notification center as the panel's second tab: newest first, read-only rows.
  function notificationsList(listProps) {
    const items = host.notifications.list();
    const rows = items.length
      ? items.map(function (n) { return notifRow(n, "nt-" + n.id); })
      : [h("div", { key: "empty", style: { opacity: 0.6, fontSize: "13px", padding: "8px 16px" } }, I18N.t("notif_empty"))];
    return React.createElement.apply(React, [focusableComp || "div", listProps].concat(rows));
  }

  // A read-only row of the Status tab: label left, monospace value right. Focusable with a
  // no-op activate so the gamepad can walk the rows (a Focusable without one is skipped).
  function statusRow(key, label, val) {
    const body = [
      h("span", { key: "l", style: { flex: "0 0 auto", color: "rgba(255,255,255,0.72)" } }, label),
      h("span", { key: "v", style: { flex: "1 1 auto", textAlign: "right", fontFamily: "monospace", wordBreak: "break-all", color: "rgba(255,255,255,0.92)" } }, String(val)),
    ];
    const st = { display: "flex", alignItems: "center", gap: "10px", minHeight: "36px", boxSizing: "border-box", padding: "6px 16px", fontSize: "12px" };
    return focusableComp
      ? h(focusableComp, { key: key, "data-fb": "ro-" + key, onActivate: function () {}, focusClassName: "shelves-rowfocus", style: st }, body)
      : h("div", { key: key, "data-fb": "ro-" + key, style: st }, body);
  }
  // Amber warnings on the Status tab (a legacy loader bundle; cooperative auto-paused).
  function statusWarnings(hd, cx) {
    const amber = { padding: "2px 16px 6px", fontSize: "12px", color: "#ffcf6b" };
    const w = [];
    if (hd.legacy) w.push(h("div", { key: "legacy", style: amber }, I18N.t("legacy_bundle_warning")));
    if (cx && cx.forceReceded) w.push(h("div", { key: "coopreceded", style: amber }, I18N.t("coop_receded_warning")));
    return w;
  }
  /* The Status tab: the mode, who hosts, key config and the warnings, read-only, from what the
     hub view knows — `s.rc` the runtime config (nothing until it is in), `s.mode` the ownership
     label, `s.hd` the host detection, `s.coex` the live coexistence state, `s.syncAge` the sync
     readout. */
  function statusRows(s) {
    const rc = s.rc;
    if (!rc) return [];
    const onOff = function (v) { return v ? "on" : "off"; };
    const rows = [
      statusRow("mode", I18N.t("cfg_mode"), s.mode),
      statusRow("hostedby", I18N.t("cfg_hosted_by"), s.hd.label),
      statusRow("dsver", I18N.t("cfg_ds_version"), s.hd.dsVersion || "—"),
    ].concat(statusWarnings(s.hd, s.coex));
    if (!rc.loader_possible) rows.push(statusRow("force", I18N.t("cfg_force_owner"), onOff(rc.force_owner)));
    rows.push(
      statusRow("sync", I18N.t("cfg_config_sync"), s.syncAge),
      statusRow("cef", I18N.t("cfg_cef"), (rc.cef_host || "") + ":" + (rc.cef_port || "")),
      statusRow("rpc", I18N.t("cfg_rpc"), rc.rpc_addr || ""),
      statusRow("recover", I18N.t("cfg_recover_cmd"), rc.recover_cmd == null ? "—" : rc.recover_cmd),
      statusRow("bundle", I18N.t("cfg_bundle"), rc.bundle_path || ""),
      statusRow("backend", I18N.t("cfg_backend"), onOff(rc.backend)),
      statusRow("boot", I18N.t("cfg_boot_movie"), onOff(rc.boot_movie)),
      statusRow("version", I18N.t("cfg_version"), rc.version || "")
    );
    return rows;
  }
  function statusList(listProps, s) {
    return React.createElement.apply(React, [focusableComp || "div", listProps].concat(statusRows(s)));
  }

  // The About tab: a few tips and the support links, short on purpose.
  const KOFI_URL = "https://ko-fi.com/F2F61WE76V";
  const PROJECT_URL = "https://github.com/santojon/ShelvesHub";
  const KOFI_QR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAuQAAALkCAIAAADIxrcyAAANRElEQVR42u3ZQY7kNhBFQaah+1/5e+HNADYGZeV0UVRG7AsSU5T6gV1JFgDAU/1lBACAWAEAECsAgFgBABArAABiBQAQKwAAYgUAECsAAGIFAECsAABiBQBArAAAYgUAQKwAAIgVAECsAACIFQBArAAAiBUAALECAIgVAACxAgCIFQAAsQIAIFYAALECACBWAADECgAgVgAAxAoAIFYAAMQKAIBYAQDECgCAWAEAxAoAgFgBABArAIBYAQAQKwCAWAEAECsAAGIFABArAABiBQAQKwAAYgUAQKwAAGIFAECsAACIFQBArAAAiBUAQKwAAIgVAACxAgCIFQAAsQIAiBUAALECACBWAACxAgAgVgAAsQIAIFYAAMQKACBWAADECgAgVgAAxAoAgFgBAMQKAIBYAQAQKwCAWAEAECsAgFgBABArAAD/dk1bcFV56g+X5Li9seuep70L0+Z84ruAd2E5WQEAln8DAQCIFQAAsQIAiBUAALECAIgVAACxAgAgVgAAsQIAIFYAAMQKACBWAADECgAgVgAAxAoAgFgBAMQKAIBYAQAGuIzgc0kM4UNVZb325KPm3JnVruv6TtrPLCcrAIBYAQAQKwCAWAEAECsAAGIFABArAABiBQAQKwAAYgUAQKwAAGIFAECsAABiBQBArAAAiBUAQKwAAIgVAECsAAA802UE31FVx91zEnP+wqw69zxtvbv25K71en99J1lOVgAAsQIAIFYAALECACBWAADECgAgVgAAxAoAIFYAAMQKAIBYAQDECgCAWAEAxAoAgFgBABArAIBYAQAQKwCAWAEAeKbLCOAfSY67blUdd137ypxhOVkBAMQKAIBYAQAQKwCAWAEAECsAgFgBABArAABiBQAQKwAAYgUAECsAAGIFAECsAABiBQBArAAAYgUAQKwAAIgVAOB0lxEA/1eS27+tqi2/7dxzx4n3DMvJCgCAWAEAxAoAgFgBAMQKAIBYAQAQKwCAWAEAECsAAGIFABArAABiBQAQKwAAYgUAQKwAAGIFAECsAABiBQBArAAA/N5lBN+RxBAerqo83xe/C7uer71hViwnKwCAWAEAECsAAGIFABArAABiBQAQKwAAYgUAQKwAAGIFAECsAABiBQBArAAAiBUAQKwAAIgVAECsAACIFQAAsQIAvM9lBJ+rKkN4sSRb9kbnuie+CyfOedp1fSdZTlYAAMQKACBWAADECgAgVgAAxAoAgFgBAMQKAIBYAQAQKwCAWAEAECsAgFgBABArAABiBQAQKwAAYgUAECsAAGIFAOD3rmkLTuKp85+qyn7mj8/ZvoLlZAUAECsAAGIFAECsAABiBQBArAAAYgUAQKwAAIgVAECsAACIFQBArAAAiBUAALECAIgVAACxAgCIFQAAsQIAIFYAgPepJLMWXHX7t51Zda47jT1pVmZ17px9r1hOVgAAsQIAIFYAAMQKACBWAADECgAgVgAAxAoAgFgBAMQKAIBYAQAQKwCAWAEAECsAgFgBABArAABiBQAQKwAAYgUAmKCSzFpw1ZbrduZ84j1P2xsnzmrXvjpxT+7aGyc+o2l7wzdnOVkBABArAIBYAQAQKwCAWAEAECsAAGIFABArAABiBQAQKwAAYgUAQKwAAGIFAECsAABiBQBArAAAiBUAQKwAAIgVAGCmywieL8nt31bVlnvedd0TdWbV2Rtm9fw5n/juT9uTZrWcrAAAiBUAQKwAAIgVAECsAACIFQAAsQIAiBUAALECAIgVAACxAgAgVgAAsQIAIFYAALECACBWAADECgAgVgAAxAoAMFMlmbXgqlHr9Xzf/Yx2rXfXPZ+4n63XO+j7vJysAABiBQBArAAAiBUAQKwAAIgVAECsAACIFQAAsQIAiBUAALECAIgVAACxAgAgVgAAsQIAIFYAALECACBWAADECgDwPpVk1oKrbv+2M6vOdXm+E/eGe3bPP3HPJ37bp81qOVkBABArAIBYAQAQKwAAYgUAECsAAGIFABArAABiBQBArAAAYgUAQKwAAGLFCAAAsQIAIFYAALECACBWAADECgAgVgAA+irJrAVXjVqv5/v8WZ14zye+g9Oer2+d79VysgIAIFYAAMQKACBWAADECgAgVgAAxAoAgFgBAMQKAIBYAQDECgCAWAEAECsAgFgBABArAIBYAQAQKwAAYgUAECsAAD+nksxacNWW6544512zOlHn+XbmPO393bWffSexN5aTFQAAsQIAiBUAALECAIgVAACxAgAgVgAAsQIAIFYAALECACBWAADECgAgVgAAxAoAgFgBAMQKAIBYAQDECgCAWAEA+FUlMYVPh1W15brTntG0OXfWO+2ep81qmhO/dSfuyeVkBQBArAAAYgUAQKwAAIgVAECsAACIFQBArAAAiBUAALECAIgVAACxAgCIFSMAAMQKAIBYAQDECgCAWAEAECsAgFgBAOirJKbw6bCqbv/2xDl31tvRmdWJ98zzn6+9YW94vsvJCgCAWAEAxAoAgFgBAMQKAIBYAQAQKwCAWAEAECsAgFgBABArAABiBQAQKwAAYgUAQKwAAGIFAECsAABiBQBArAAA/KqSzFpw1aj1nvh8O8+os94T94b1+l7Zk667nKwAAIgVAACxAgCIFQAAsQIAiBUAALECACBWAACxAgAgVgAAsQIAIFYAAMQKACBWAADECgCAWAEAxAoAgFgBAMQKAMD3XUbwuSS3f1tVW+5513V3zXna851m15x37clp3zpzZjlZAQDECgCAWAEAxAoAgFgBABArAIBYAQAQKwCAWAEAECsAAGIFABArAABiBQBArAAAYgUAQKwAAGIFAECsAACIFQDgFJcRfEeS27+tquPuuaOz3l1z3jWrafv5xD3pm2NWvhvLyQoAIFYAAMQKAIBYAQDECgCAWAEAxAoAgFgBABArAIBYAQAQKwCAWAEAECsAAGIFABArAABiBQAQKwAAYgUAQKwAAO9TSWYtuOr2bzuz2nXdXbPaxayev59PfL7T9saJTtzP096F5WQFABArAABiBQBArAAAYgUAQKwAAGIFAECsAACIFQBArAAAiBUAQKwAAIgVAACxAgCIFQAAsQIAiBUAALECACBWAIA3qSSmwHs2dNXt33behc51O058f83q+ft52t440bS/3U5WAACxAgAgVgAAsQIAIFYAAMQKACBWAADECgAgVgAAxAoAgFgBAMQKAIBYAQDECgCAWAEAECsAgFgBABArAIBYAQB4nGvagqvKU3+4JFt+y/Of7653v3PPJ35zds3KfmY5WQEAxAoAgFgBAMQKAIBYAQAQKwCAWAEAECsAgFgBABArAABiBQAQKwAAYgUAQKwAAGIFAECsAABiBQBArAAAiBUA4BSXEXwuiSF8qKpGXXfavurMubNe17Unn3bPu/bGcrICACBWAADECgAgVgAAxAoAIFYAAMQKAIBYAQDECgCAWAEAECsAgFgBABArAIBYAQAQKwAAYgUAECsAAGIFABArAAB7XUbwHVV13D0nGfWMdq13197orHfa3vDNMaufeBd2XXc5WQEAECsAgFgBABArAABiBQAQKwAAYgUAECsAAGIFAECsAABiBQBArAAAYsUIAACxAgAgVgAAsQIAIFYAAMQKACBWAAD6LiOAf1TV7d8m2fLbzj3vmlXHtFl11uv9fT7PdzlZAQDECgCAWAEAxAoAgFgBABArAIBYAQAQKwAAYgUAECsAAGIFABArAABiBQBArAAAYgUAQKwAAGIFAECsAACIFQDgXJcRQF9V3f5tklH33Llu57cd09bLu9/95WQFAECsAABiBQBArAAAiBUAQKwAAIgVAECsAACIFQAAsQIAiBUAALECAIgVIwAAxAoAgFgBAMQKAIBYAQAQKwCAWAEA6LuM4DuSGMLD51xVo67r+dobP3Fd7y/LyQoAIFYAAMQKAIBYAQDECgCAWAEAxAoAgFgBABArAIBYAQAQKwAAYgUAECsAAGIFABArAABiBQBArAAAYgUAQKwAABNcRvC5qjIEz+iPXzeJe/4Cc373nDvXnfaMlpMVAACxAgCIFQAAsQIAIFYAALECACBWAACxAgAgVgAAxAoAIFYAAMQKACBWjAAAECsAAGIFABArAABiBQBArAAAYgUAoK+SmAIAsJysAACIFQBArAAAiBUAALECAIgVAACxAgCIFQAAsQIAIFYAALECACBWAACxAgAgVgAAxAoAIFYAAMQKACBWAADECgCAWAEAxAoAgFgBAMQKAIBYAQAQKwCAWAEAECsAAGIFABArAABiBQAQKwAAYgUAQKwAAGIFAECsAABiBQBArAAAiBUAQKwAAIgVAECsAACIFQAAsQIAiBUAALECAIgVAACxAgAgVgAAsQIAIFYAAMQKACBWAADECgAgVgAAxAoAgFgBAMQKAIBYAQDECgCAWAEAECsAgFgBABArAIBYAQAQKwAAYgUAECsAAGIFABArAABiBQBArAAAYgUAQKwAAIgVAECsAACIFQBArAAAiBUAALECABzkb8NBQq2BVSslAAAAAElFTkSuQmCC";
  const HEART_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
  function openInBrowser(url) {
    try { const s = window.SteamClient && window.SteamClient.System; if (s && typeof s.OpenInSystemBrowser === "function") s.OpenInSystemBrowser(url); } catch (e) {}
  }
  function linkButton(key, label, url, svg) {
    const st = { display: "inline-flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 14px", borderRadius: "4px", border: "none", background: "rgba(255,255,255,0.12)", color: "#fff", fontSize: "13px", cursor: "pointer" };
    const kids = svg ? [h("span", { key: "i", style: { display: "inline-flex" }, dangerouslySetInnerHTML: { __html: svg } })] : [];
    return clickable(function () { openInBrowser(url); }, { key: key, "data-fb": key, style: st }, kids.concat([h("span", { key: "t" }, label)]));
  }
  function kofiCard() {
    const btnRow = { display: "flex", gap: "8px" };
    const buttons = [linkButton("about-kofi", "Ko-fi", KOFI_URL, HEART_SVG), linkButton("about-github", "GitHub", PROJECT_URL)];
    return h("div", { key: "kofi", style: { display: "flex", gap: "14px", alignItems: "center", margin: "10px 16px", padding: "12px", borderRadius: "10px", background: "rgba(255,94,91,0.08)", border: "1px solid rgba(255,94,91,0.25)" } },
      h("img", { key: "qr", src: KOFI_QR, alt: "Ko-fi QR code", width: 112, height: 112, style: { flex: "0 0 auto", width: "112px", height: "112px", padding: "6px", background: "#fff", borderRadius: "6px" } }),
      h("div", { key: "side", style: { display: "flex", flexDirection: "column", gap: "10px", minWidth: "0" } },
        h("div", { key: "hint", style: { fontSize: "13px", lineHeight: "18px", color: "#dcdedf" } }, I18N.t("about_kofi_hint")),
        focusableComp ? h(focusableComp, { key: "btns", "flow-children": "horizontal", style: btnRow }, buttons) : h("div", { key: "btns", style: btnRow }, buttons)));
  }
  function aboutList(listProps, version) {
    const tip = { padding: "5px 16px", fontSize: "12px", lineHeight: "17px", color: "rgba(255,255,255,0.75)" };
    const rows = [
      h("div", { key: "ver", style: { padding: "4px 16px 10px", fontSize: "16px", fontWeight: "700" } }, "ShelvesHub" + (version ? " v" + version : "")),
      h("div", { key: "tt", style: { padding: "2px 16px 4px", fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" } }, I18N.t("about_tips")),
    ].concat(["about_tip_open", "about_tip_status", "about_tip_apply"].map(function (k) { return h("div", { key: k, style: tip }, "· " + I18N.t(k)); }), [kofiCard()]);
    return React.createElement.apply(React, [focusableComp || "div", listProps].concat(rows));
  }

  const DPAD_LEFT = 22, DPAD_RIGHT = 23;
  // Ctrl+Shift + one of these opens the panel on that tab.
  const KEY_TABS = { KeyN: SIDE_TAB_NOTIF, KeyT: SIDE_TAB_STATUS, KeyL: SIDE_TAB_LOGS };
  const FOCUS_SELECTOR = ".shelves-gpfocus, .shelves-rowfocus, .gpfocus";
  const DOUBLE_KEY_MS = 400;
  // Steam's controller input stream: through the QAM document's opener, else this window.
  function inputApi(doc) {
    const pick = function (sc) { const i = sc && sc.Input; return (i && typeof i.RegisterForControllerInputMessages === "function") ? i : null; };
    try { const o = doc.defaultView.opener; const i = pick(o && o.SteamClient); if (i) return i; } catch (e) {}
    try { return pick(window.SteamClient); } catch (e) { return null; }
  }
  // The gamepad-focused element inside the hub root: our focus classes, Steam's, else the nav controller's last focus node.
  function focusedIn(root) {
    const el = root.querySelector(FOCUS_SELECTOR);
    if (el) return el;
    try {
      const ctrl = root.ownerDocument.defaultView.opener.FocusNavController;
      const node = ctrl && ctrl.m_ActiveContext && ctrl.m_ActiveContext.m_lastFocusNode;
      const target = node && node.m_element;
      return (target && root.contains(target)) ? target : null;
    } catch (e) { return null; }
  }
  function inSidecar(root, el) { const s = root.querySelector(".shelves-sidecar"); return !!(s && el && s.contains(el)); }
  function onScreen(root) { return root.getClientRects().length > 0; }
  // Nothing of ours to the right of this focusable (the plugin's edge rule).
  function atRightEdge(root, el) { return root.getBoundingClientRect().right - el.getBoundingClientRect().right <= 40; }
  // The gamepad UI's main window document, for a keyboard shortcut typed while it holds focus.
  function mainWindowDoc(doc) {
    try { return doc.defaultView.opener.SteamUIStore.WindowStore.GamepadUIMainWindowInstance.m_BrowserWindow.document; } catch (e) { return null; }
  }
  /* Opens the panel without a pointer, like the plugin's sidecar: a second D-pad right on the
     same rightmost focusable of the hub view (the first only lands on it); D-pad left out of the
     panel closes it. Keyboard: Ctrl+Shift + N (notifications), T (status) or L (logs); a double
     ArrowRight only where the page gets arrow keys (the desktop clients keep them for Steam's own
     navigation). `api.current` is refreshed per render; listeners live while the view is mounted. */
  function useSidecarGestures(ref, api) {
    React.useEffect(function () {
      const el = ref.current;
      if (!el) return undefined;
      const root = el.closest(".shelves-hub-root") || el;
      const doc = root.ownerDocument, win = doc.defaultView || window;
      let lastRight = null, wasInside = false, seenSeq = -1, lastArrow = 0;
      // A fresh open moved focus into the panel (takeFocus) without a button press.
      function tracked() {
        const a = api.current;
        if (a.seq !== seenSeq) { seenSeq = a.seq; wasInside = a.isOpen(); }
        return a;
      }
      function leftPress(a, inside) {
        if (inside) win.setTimeout(function () { if (!inSidecar(root, focusedIn(root))) a.close(); }, 80);
        else if (wasInside) a.close();
      }
      function rightPress(a, f) {
        const edge = !a.isOpen() && onScreen(root) && f && atRightEdge(root, f);
        if (!edge) { lastRight = null; return; }
        if (lastRight !== f) { lastRight = f; return; }
        lastRight = null;
        win.setTimeout(function () { if (focusedIn(root) === f) a.open(a.tabFor(f)); }, 80);
      }
      function onPad(_slot, button, pressed) {
        if (!pressed) return;
        const a = tracked();
        const f = focusedIn(root);
        const inside = inSidecar(root, f);
        if (button === DPAD_LEFT && a.isOpen()) leftPress(a, inside);
        else if (button === DPAD_RIGHT) rightPress(a, f);
        else lastRight = null;
        wasInside = inside;
      }
      function onKey(e) {
        const a = tracked();
        const keyTab = e.ctrlKey && e.shiftKey && Object.prototype.hasOwnProperty.call(KEY_TABS, e.code) ? KEY_TABS[e.code] : null;
        if (keyTab) {
          e.preventDefault(); e.stopPropagation();
          a.open(keyTab);
          return;
        }
        if (e.key !== "ArrowRight" || a.isOpen() || !onScreen(root)) { lastArrow = 0; return; }
        const now = Date.now();
        if (now - lastArrow <= DOUBLE_KEY_MS) { lastArrow = 0; a.open(a.tabFor(focusedIn(root))); } else { lastArrow = now; }
      }
      const input = inputApi(doc);
      let reg = null;
      try { reg = input ? input.RegisterForControllerInputMessages(onPad) : null; } catch (e) { reg = null; }
      const docs = [doc];
      const main = mainWindowDoc(doc);
      if (main && main !== doc) docs.push(main);
      docs.forEach(function (d) { try { d.addEventListener("keydown", onKey, true); } catch (e) {} });
      return function () {
        try { if (reg && typeof reg.unregister === "function") reg.unregister(); } catch (e) {}
        docs.forEach(function (d) { try { d.removeEventListener("keydown", onKey, true); } catch (e) {} });
      };
    }, []);
  }
