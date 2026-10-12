/* runtime/shelves-host-sidecar.js — the hub's management/log sidecar: a panel that widens the
   Quick Access menu (the compositor message Steam's own friends list uses) and shows the host's
   log stream beside the ShelvesHub view; plus the notification-center rows the hub view and
   Steam's Notifications tab share. Assembled after shelves-host-api.js (shared closure). */

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
  // One notification-center entry: title (bold until read), body, age — a focusable
  // read-only row, the same shape in the hub view and inside Steam's tab.
  function notifRow(n, key) {
    const body = [
      h("div", { key: "t", style: { flex: "1 1 auto", minWidth: "0", display: "flex", flexDirection: "column", gap: "1px" } }, [
        h("span", { key: "ti", style: { fontWeight: n.read ? "400" : "700" } }, n.title),
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
    /* Geometry defaults (overridden by live measurement): sit right of the hub view, stretch to
       the QAM panel's edges. The expanded root and its clipping ancestors must let the panel
       overflow to the right; `:has()` is available in Steam's Chromium. */
    const CSS =
      ".shelves-panel .shelves-hub-root{position:relative;}" +
      ".shelves-panel .shelves-hub-root[data-shelves-expanded=\"1\"]{overflow:visible!important;}" +
      ".shelves-panel:has([data-shelves-expanded=\"1\"])," +
      "[id^=\"quickaccess_content_\"]:has([data-shelves-expanded=\"1\"])," +
      "[id^=\"quickaccess_content_\"]:has([data-shelves-expanded=\"1\"])>*{overflow:visible!important;}" +
      ".shelves-sidecar{position:absolute;left:300px;top:0;width:503px;height:440px;box-sizing:border-box;" +
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
    /* Size from the live QAM. The left offset is locked at the first non-zero
       measurement (the hub view's width BEFORE the menu widens) and the hub root is
       pinned to it, so the widened menu never pushes the panel off to the right;
       width/height follow the QAM panel (viewport when it can't be found). */
    function measure(side) {
      const doc = side.ownerDocument, win = doc.defaultView || window;
      const root = side.parentElement;
      if (!side.dataset.left && root) {
        const w = Math.round(root.getBoundingClientRect().width);
        if (w > 0) { side.dataset.left = String(w); root.style.width = w + "px"; }
      }
      if (side.dataset.left) side.style.left = side.dataset.left + "px";
      const panel = side.closest('[id^="quickaccess_content_"]');
      const pr = panel ? panel.getBoundingClientRect() : null;
      const sr = side.getBoundingClientRect();
      const right = pr ? pr.right : win.innerWidth;
      const bottom = pr ? pr.bottom : win.innerHeight;
      side.style.width = Math.max(280, Math.round(right - sr.left)) + "px";
      side.style.height = Math.max(320, Math.round(bottom - sr.top + 8)) + "px";
    }
    function sideOf(inner) { return inner && inner.closest ? inner.closest(".shelves-sidecar") : null; }
    /* Measure on mount, on viewport resize and shortly after (QAM layout settling),
       then move gamepad focus into the panel. Every observer and timer is torn down
       with the panel, and the pinned root width is released. */
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
        const t3 = win.setTimeout(function () {
          const first = side.querySelector("[data-fb]");
          if (first) takeFocus(first);
        }, 90);
        const root = side.parentElement;
        return function () {
          if (ro) ro.disconnect();
          win.removeEventListener("resize", run);
          win.clearTimeout(t1); win.clearTimeout(t2); win.clearTimeout(t3);
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
