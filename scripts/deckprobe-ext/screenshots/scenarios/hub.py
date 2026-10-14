"""ShelvesHub management-panel screenshots.

Each scenario opens the QAM, reaches the Deck Shelves tab (the one this host
owns), opens the **ShelvesHub panel** via the `open-hub` button (present at the
end of the tab even while Deck Shelves is loaded), then sets the collapsible
sections to the wanted state by clicking their headers — so the QAM stays
visibly open (a hidden QAM keeps its DOM but renders the panel at 0x0, which
can't be captured). Captures clip to `[data-fb-panel]` so the wider Big Picture
QAM leaves no black gap. `window.__SHELVES_LOCALE__` fixes the capture language.

Target the Mac with:
  DECKPROBE_QAM_SCOPE_SEL='.deck-shelves-qam-scope,[data-fb-panel]' \\
  node deckprobe/scripts/py.mjs -m deckprobe.screenshots.run \\
    --host 127.0.0.1 --port 8080 \\
    --scenarios-dir scripts/deckprobe-ext/screenshots/scenarios --out assets/screenshots
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, Optional

from deckprobe.screenshots.lib.nav import (
    navigate_to_ds_qam,
    close_qam,
    navigate_home,
    home_via_mainmenu,
    _qam_eval,
    OPEN_QAM_EXPR,
    _DS_OWN_TAB_CLICK,
)
from deckprobe.screenshots.lib.capture import _capture
from deckprobe.screenshots.lib.cdp import Session, list_targets
from deckprobe.screenshots.lib.registry import register

# Same resolution order as Deck-Shelves' scripts/deckprobe-ext/screenshots/
# scenarios/_locale.py: `--locale` passed to the runner (`screenshots/run.py`
# exports it as this env var) wins, else today's exact default (en-US).
LOCALE = os.environ.get("DECKPROBE_SCREENSHOTS_LOCALE") or "en-US"

# The child selector that is only in the DOM when a given section is expanded.
_SECTION_CHILD = {
    "sec-updates": '[data-fb="download"]',
    "sec-troubleshooting": '[data-fb="logs"]',
    "sec-config": '[data-fb="interval_secs+"]',
}

# The hub panel, widened to the side panel when one is open: the side panel sits to
# the RIGHT of the hub view in the menu document (x 348-854 at 854 wide), full height.
_CLIP_EXPR = """
(function(){
  var p = document.querySelector('[data-fb-panel]');
  if(!p) return null;
  var r = p.getBoundingClientRect();
  if(r.width < 50 || r.height < 50) return null;
  var right = r.right, bottom = r.bottom;
  var s = document.querySelector('[data-fb="sidecar"]');
  if (s) { var q = s.getBoundingClientRect(); if (q.width > 50) { right = Math.max(right, q.right); bottom = Math.max(bottom, q.bottom); } }
  return {x:0, y:0, width: Math.ceil(right)+8, height: Math.ceil(bottom)+4, scale:1};
})()
"""


def _debug(msg: str) -> None:
    if os.environ.get("SHOTS_DEBUG"):
        print("    [hub] " + msg, file=sys.stderr)


def _q(sel: str) -> str:
    return "document.querySelector('" + sel.replace("'", "\\'") + "')"


def _present(host: str, port: int, sel: str) -> bool:
    return _qam_eval(host, port, "!!" + _q(sel)) is True


def _click(host: str, port: int, sel: str) -> str:
    return _qam_eval(host, port, "(function(){var e=%s;if(!e)return 'no';e.click();return 'ok';})()" % _q(sel)) or "no"


def _panel_visible(host: str, port: int) -> bool:
    return _qam_eval(host, port, "(function(){var p=%s;if(!p)return false;var r=p.getBoundingClientRect();return r.width>50&&r.height>50;})()" % _q("[data-fb-panel]")) is True


def _set_locale(sjc, host: str, port: int) -> None:
    expr = "(function(){try{window.__SHELVES_LOCALE__=%s;}catch(e){}return 1;})()" % json.dumps(LOCALE)
    try:
        sjc.evaluate(expr)
    except Exception:
        pass
    _qam_eval(host, port, expr)


def _qam_visible(host: str, port: int) -> bool:
    """The menu document is `hidden` while the Quick Access menu is closed — the
    one observable the blind toggle lacks."""
    return _qam_eval(host, port, "document.visibilityState === 'visible'") is True


def _ensure_qam(sjc, host: str, port: int, shown: bool) -> bool:
    """Flip the menu toggle only while the document disagrees with `shown`, so a
    close never lands on an already-closed menu (that desync skipped every shot)."""
    for _ in range(4):
        if _qam_visible(host, port) == shown:
            return True
        try:
            sjc.evaluate(OPEN_QAM_EXPR)
        except Exception:
            pass
        time.sleep(1.2)
    return _qam_visible(host, port) == shown


def _reach_panel(sjc, host: str, port: int) -> bool:
    """Reach the DS tab and make sure the hub panel is visibly open (non-zero).

    The hub view survives a menu close and a tab switch, so a previous scenario
    can leave it open: go back to the editor first; let the nav helper reach the
    tab only when the editor's scope is not already in the menu document (its
    own toggling is blind); open the hub view once; then show the menu by its
    observed state."""
    dbg = _debug
    dbg("start: panel=%s back=%s scope=%s open-hub=%s visible=%s" % (
        _present(host, port, "[data-fb-panel]"), _present(host, port, '[data-fb="back"]'),
        _present(host, port, ".deck-shelves-qam-scope"), _present(host, port, '[data-fb="open-hub"]'),
        _qam_visible(host, port)))
    if _present(host, port, "[data-fb-panel]") and _present(host, port, '[data-fb="back"]'):
        dbg("back → %s" % _click(host, port, '[data-fb="back"]'))
        time.sleep(0.6)
    if not _present(host, port, ".deck-shelves-qam-scope"):
        ok = navigate_to_ds_qam(sjc, host, port)
        dbg("navigate_to_ds_qam → %s (scope now %s, visible %s)" % (ok, _present(host, port, ".deck-shelves-qam-scope"), _qam_visible(host, port)))
        if not ok:
            return False
    _set_locale(sjc, host, port)
    if not _present(host, port, "[data-fb-panel]") and _present(host, port, '[data-fb="open-hub"]'):
        dbg("open-hub → %s" % _click(host, port, '[data-fb="open-hub"]'))
        time.sleep(1.0)
    shown = _ensure_qam(sjc, host, port, True)
    dbg("ensure_qam(shown) → %s; panel=%s visible=%s" % (shown, _present(host, port, "[data-fb-panel]"), _qam_visible(host, port)))
    if not shown:
        return False
    # Steam keeps every tab's DOM while the menu shows another tab (0x0 for ours):
    # select the Deck Shelves tab by its strip entry until the panel measures.
    for _ in range(3):
        time.sleep(0.6)
        if _panel_visible(host, port):
            dbg("panel visible")
            return True
        dbg("tab click → %s" % _qam_eval(host, port, _DS_OWN_TAB_CLICK))
        time.sleep(1.0)
    vis = _panel_visible(host, port)
    dbg("panel_visible → %s" % vis)
    return vis


def _set_sections(host: str, port: int, want_open: Dict[str, bool]) -> None:
    """Click section headers so each ends in the wanted open/closed state."""
    for sec, child in _SECTION_CHILD.items():
        target = want_open.get(sec, False)
        is_open = _present(host, port, child)
        if is_open != target:
            _click(host, port, '[data-fb="sec-%s"]' % sec)
            time.sleep(0.4)


def _capture_panel(host: str, port: int, out_path: Path):
    """Capture from whichever QuickAccess target holds a laid-out panel."""
    for _ in range(5):
        for t in [x for x in list_targets(host, port) if "quickaccess" in x.get("title", "").lower()]:
            sess = None
            try:
                sess = Session.open(host, port, t)
                clip = sess.evaluate(_CLIP_EXPR)
                if isinstance(clip, dict):
                    p = _capture(sess, out_path, clip=clip, from_surface=True)
                    if p and p.exists() and p.stat().st_size > 3000:
                        return p
            except Exception:
                pass
            finally:
                if sess is not None:
                    try:
                        sess.close()
                    except Exception:
                        pass
        time.sleep(0.7)
    return out_path if out_path.exists() else None


def _shot(sjc, host, port, out_dir, want_open, name, extra=None):
    if not _reach_panel(sjc, host, port):
        _ensure_qam(sjc, host, port, False)
        return {}
    _set_sections(host, port, want_open)
    if extra:
        extra(host, port)
    time.sleep(0.5)
    out = out_dir / name
    p = _capture_panel(host, port, out)
    _ensure_qam(sjc, host, port, False)
    return {name: p} if p else {}


@register("qam_tab")
def qam_tab(sjc, host: str, port: int, out_dir: Path) -> Dict[str, Path]:
    """The Deck Shelves editor tab in the QAM — its options (NOT the ShelvesHub
    panel, which `hub_panel` captures). Registered FIRST so the full flow captures
    it while the QAM is fresh — the hub scenarios' repeated navigation degrades the
    QAM toggle for the rest of the run. Reaches the DS editor scope via
    `navigate_to_ds_qam` (which owns the QAM toggling — a manual close-first
    desyncs it), just WITHOUT clicking open-hub. Uses the helpers defined further
    down (resolved at call time)."""
    reached = False
    for _ in range(4):
        if navigate_to_ds_qam(sjc, host, port):
            reached = True
            break
        time.sleep(1.0)
    if not reached:
        close_qam(sjc)
        return {}
    _set_locale(sjc, host, port)
    time.sleep(0.6)
    out = out_dir / "qam-tab.png"
    p = _capture_scope(host, port, out, ".deck-shelves-qam-scope", max_h=760)
    close_qam(sjc)
    return {"qam-tab.png": p} if p else {}


@register("hub_panel")
def hub_panel(sjc, host: str, port: int, out_dir: Path) -> Dict[str, Path]:
    """ShelvesHub panel — the Updates section open (master auto-update +
    ShelvesHub / Deck Shelves switches + channels, Download, Update)."""
    return _shot(sjc, host, port, out_dir, {"sec-updates": True}, "hub-panel.png")


@register("hub_troubleshooting")
def hub_troubleshooting(sjc, host: str, port: int, out_dir: Path) -> Dict[str, Path]:
    """Troubleshooting section — View status, View logs, restart the backend,
    the disable-until-restart toggle."""
    return _shot(sjc, host, port, out_dir, {"sec-troubleshooting": True}, "hub-troubleshooting.png")


@register("hub_config")
def hub_config(sjc, host: str, port: int, out_dir: Path) -> Dict[str, Path]:
    """Configuration section (the editable safe subset); the read-only Status
    lives in the side panel now (`hub_status`)."""
    return _shot(sjc, host, port, out_dir, {"sec-config": True}, "hub-config.png")


def _open_side(host: str, port: int, button: str, view: str) -> None:
    """Click a row/icon that opens the side panel, wait for its view to mount."""
    _click(host, port, '[data-fb="%s"]' % button)
    for _ in range(10):
        time.sleep(0.5)
        if _present(host, port, '[data-fb="%s"]' % view):
            break
    time.sleep(0.6)


@register("hub_logs")
def hub_logs(sjc, host: str, port: int, out_dir: Path) -> Dict[str, Path]:
    """The side panel's Logs tab — the merged host + runtime stream — opened
    from "View logs" in Troubleshooting (the menu widens; the clip starts at the
    document's left edge, so the panel is in the shot)."""
    return _shot(sjc, host, port, out_dir, {"sec-troubleshooting": True}, "hub-logs.png",
                 extra=lambda h, p: _open_side(h, p, "logs", "logs-view"))


@register("hub_status")
def hub_status(sjc, host: str, port: int, out_dir: Path) -> Dict[str, Path]:
    """The side panel's Status tab — mode, who hosts, versions, endpoints —
    opened from "View status" in Troubleshooting."""
    return _shot(sjc, host, port, out_dir, {"sec-troubleshooting": True}, "hub-status.png",
                 extra=lambda h, p: _open_side(h, p, "status", "status-view"))


@register("hub_notifications")
def hub_notifications(sjc, host: str, port: int, out_dir: Path) -> Dict[str, Path]:
    """The side panel's Notifications tab, opened from the bell by the title.
    The center is cleared and two generic entries posted first (through the
    host's own `notifications.toast`, in the shared context where the host
    object lives), so the shot is in the capture language whatever the plugin
    posted in Steam's — the entries are transient, nothing is persisted."""
    def seed(host, port):
        try:
            sjc.evaluate("(function(){try{window.__SHELVES_HOST__.notifications.clear();}catch(e){}return 1;})()")
        except Exception:
            pass
        for body in ("Deck Shelves is up to date.", "Hosting Deck Shelves on this device."):
            try:
                sjc.evaluate("(function(){try{window.__SHELVES_HOST__.notifications.toast({title:'ShelvesHub',body:%s});}catch(e){}return 1;})()" % json.dumps(body))
            except Exception:
                pass
            time.sleep(0.6)
        _open_side(host, port, "open-notif", "notif-view")
    return _shot(sjc, host, port, out_dir, {"sec-troubleshooting": True}, "hub-notifications.png", extra=seed)


# ── Deck Shelves views (the tab this host opens + the Home it hosts) ─────────
def _scope_clip_expr(sel: str, max_h: int = 0) -> str:
    # Clip from the QAM document ORIGIN (0,0) so the tab header — the "Deck
    # Shelves" title, its icons, and the left tab-icon strip, all ABOVE the
    # `.deck-shelves-qam-scope` element — is included, not just the options list.
    # `max_h` (CSS px, absolute from the top) caps the height so the shot stops at
    # the section options instead of the whole tall scrollable tab.
    cap = ("Math.min(r.bottom, %d)" % max_h) if max_h else "r.bottom"
    return (
        "(function(){var p=document.querySelector(%s);if(!p)return null;"
        "var r=p.getBoundingClientRect();if(r.width<50||r.height<50)return null;"
        "return {x:0,y:0,width:Math.ceil(r.right)+8,height:Math.ceil(%s)+4,scale:1};})()"
    ) % (json.dumps(sel), cap)


def _capture_scope(host: str, port: int, out_path: Path, sel: str, max_h: int = 0):
    """Capture a QuickAccess target, clipped to the first element matching `sel`."""
    expr = _scope_clip_expr(sel, max_h)
    for _ in range(5):
        for t in [x for x in list_targets(host, port) if "quickaccess" in (x.get("title", "") or "").lower()]:
            sess = None
            try:
                sess = Session.open(host, port, t)
                clip = sess.evaluate(expr)
                if isinstance(clip, dict):
                    p = _capture(sess, out_path, clip=clip, from_surface=True)
                    if p and p.exists() and p.stat().st_size > 3000:
                        return p
            except Exception:
                pass
            finally:
                if sess is not None:
                    try:
                        sess.close()
                    except Exception:
                        pass
        time.sleep(0.7)
    return out_path if out_path.exists() else None


def _capture_bigpicture(host: str, port: int, out_path: Path):
    """Capture the full Big Picture window surface (the Home lives here)."""
    for _ in range(5):
        for t in list_targets(host, port):
            title = (t.get("title", "") or "").lower()
            url = (t.get("url", "") or "").lower()
            if "big picture" in title or "gamepad" in url:
                sess = None
                try:
                    sess = Session.open(host, port, t)
                    p = _capture(sess, out_path, clip=None, from_surface=True)
                    if p and p.exists() and p.stat().st_size > 5000:
                        return p
                except Exception:
                    pass
                finally:
                    if sess is not None:
                        try:
                            sess.close()
                        except Exception:
                            pass
        time.sleep(0.7)
    return out_path if out_path.exists() else None


@register("home")
def home(sjc, host: str, port: int, out_dir: Path) -> Dict[str, Path]:
    """The Deck Shelves Home — the custom shelves this host injects, full-screen."""
    _set_locale(sjc, host, port)
    close_qam(sjc)
    if not home_via_mainmenu(sjc, host, port):
        navigate_home(sjc)
    time.sleep(2.0)
    out = out_dir / "home.png"
    p = _capture_bigpicture(host, port, out)
    if not p:
        return {}
    shots = {"home.png": p}
    webp = _to_webp(p)
    if webp:
        shots["home.webp"] = webp
    return shots


def _to_webp(png: Path) -> Optional[Path]:
    """The site serves the WebP (about a tenth of the PNG); written beside the
    PNG when Pillow is available, skipped quietly otherwise."""
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError:
        return None
    out = png.with_suffix(".webp")
    try:
        Image.open(png).convert("RGB").save(out, quality=85, method=6)
    except OSError:
        return None
    return out
