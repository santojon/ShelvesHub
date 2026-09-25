//! Chrome DevTools Protocol (CDP) client.
//!
//! Steam's UI is a CEF (Chromium Embedded Framework) application. CEF speaks
//! the exact same DevTools protocol as Chrome/Chromium, so the same client
//! works against:
//!
//! - the Steam renderer on a Steam Deck (CEF remote debugging on port 8080),
//! - a locally-launched Chromium for offline testing (`docs/debugging.md`).
//!
//! The implementation is deliberately written from scratch against the public
//! CDP specification — no third-party CDP/Steam code is adapted. It uses a
//! blocking WebSocket (`tungstenite`) and hand-rolled HTTP for the `/json`
//! discovery endpoint to keep the dependency surface minimal.
//!
//! This module holds the shared types, target discovery and the minimal HTTP
//! GET; the live WebSocket session lives in the [`client`] submodule.

use std::fmt;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

mod client;
pub use client::CdpClient;

const HTTP_TIMEOUT: Duration = Duration::from_secs(5);

/// A DevTools target as reported by `GET /json`.
#[derive(Debug, Clone, Deserialize)]
pub struct Target {
    #[serde(default)]
    pub id: String,
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(rename = "webSocketDebuggerUrl", default)]
    pub ws_url: Option<String>,
}

/// Errors raised by the CDP client. Kept as a single string-carrying variant —
/// callers log it and retry rather than branch on the cause.
#[derive(Debug)]
pub struct CdpError(pub String);

impl fmt::Display for CdpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for CdpError {}

impl CdpError {
    pub(crate) fn new(msg: impl Into<String>) -> Self {
        CdpError(msg.into())
    }
}

pub type Result<T> = std::result::Result<T, CdpError>;

/// Discover all DevTools targets exposed at `http://host:port/json`.
pub fn discover_targets(host: &str, port: u16) -> Result<Vec<Target>> {
    let body = http_get(host, port, "/json")?;
    serde_json::from_str(&body).map_err(|e| CdpError::new(format!("parse /json: {e}")))
}

/// The browser-level DevTools WebSocket URL (`/json/version`). A connection to
/// it can drive the `Target` domain (auto-attach to every page as it is
/// created), which a per-page connection cannot.
pub fn browser_ws_url(host: &str, port: u16) -> Result<String> {
    let body = http_get(host, port, "/json/version")?;
    let v: Value = serde_json::from_str(&body)
        .map_err(|e| CdpError::new(format!("parse /json/version: {e}")))?;
    v.get("webSocketDebuggerUrl")
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| CdpError::new("no webSocketDebuggerUrl in /json/version"))
}

/// Pick the renderer to inject into.
///
/// When `filter` is set, the first target whose title or URL contains it
/// (case-insensitive) wins. Otherwise we prefer Steam's shared JS context /
/// Big Picture window, then fall back to the first `page` target that has a
/// debugger URL.
pub fn find_renderer<'a>(targets: &'a [Target], filter: Option<&str>) -> Option<&'a Target> {
    let has_ws = |t: &&Target| t.ws_url.is_some();

    if let Some(needle) = filter {
        let needle = needle.to_lowercase();
        return targets.iter().filter(has_ws).find(|t| {
            t.title.to_lowercase().contains(&needle) || t.url.to_lowercase().contains(&needle)
        });
    }

    // Steam's main UI context, in priority order. `SharedJSContext` is the React
    // app context that actually holds the webpack modules / React instance — it
    // must win over the "Big Picture" wrapper window, which has neither.
    const STEAM_HINTS: [&str; 4] = [
        "sharedjscontext",
        "steamloopback.host",
        "steamui",
        "big picture",
    ];

    for hint in STEAM_HINTS {
        let found = targets
            .iter()
            .filter(has_ws)
            .find(|t| t.title.to_lowercase().contains(hint) || t.url.to_lowercase().contains(hint));
        if found.is_some() {
            return found;
        }
    }

    targets
        .iter()
        .filter(has_ws)
        .find(|t| t.kind == "page")
        .or_else(|| targets.iter().find(has_ws))
}

/// Whether Steam's visible UI windows are present.
///
/// The screen the user sees is rendered by windows (Big Picture, Main Menu,
/// the Quick Access popup, …) that are *separate* targets from
/// `SharedJSContext` — the background React/webpack context. When those windows
/// are torn down the screen goes black, yet `SharedJSContext` survives and keeps
/// answering evals (route stays `/routes/library/home`). So a renderer probe is
/// a false health signal; the target list is the real one. A lone
/// `SharedJSContext` (no other `page` target) means the UI has collapsed.
pub fn ui_windows_present(targets: &[Target]) -> bool {
    targets
        .iter()
        .any(|t| t.kind == "page" && !t.title.to_lowercase().contains("sharedjscontext"))
}

/// Whether the Steam gamepad / Big Picture UI is the one on screen (as opposed to
/// the plain desktop client). The gamepad UI runs its windows under a distinct
/// browser identity — a "Big Picture" window plus `MainMenu_*` / `QuickAccess_*`
/// popups, all served to the "Valve Steam Gamepad" user-agent — none of which the
/// desktop client has. Used to gate injection off the desktop client by default.
pub fn gamepad_ui_active(targets: &[Target]) -> bool {
    targets.iter().any(|t| {
        let title = t.title.to_lowercase();
        let url = t.url.to_lowercase();
        title.contains("big picture")
            || title.starts_with("mainmenu")
            || title.starts_with("quickaccess")
            || url.contains("gamepad")
    })
}

/// Minimal blocking HTTP GET for the localhost `/json` discovery endpoint.
/// Avoids pulling in a full HTTP client just to read a JSON array over loopback.
///
/// Reads the body using the `Content-Length` header rather than waiting for the
/// server to close the connection — CEF/Chromium's DevTools HTTP server keeps
/// the connection alive, so an EOF-based read would just time out.
fn http_get(host: &str, port: u16, path: &str) -> Result<String> {
    let mut stream = TcpStream::connect((host, port))
        .map_err(|e| CdpError::new(format!("tcp connect {host}:{port}: {e}")))?;
    stream.set_read_timeout(Some(HTTP_TIMEOUT)).ok();
    stream.set_write_timeout(Some(HTTP_TIMEOUT)).ok();

    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| CdpError::new(format!("http write: {e}")))?;

    let mut raw: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    let mut header_end: Option<usize> = None;
    let mut content_length: Option<usize> = None;

    loop {
        // Stop as soon as the full body (per Content-Length) has arrived.
        if let (Some(he), Some(cl)) = (header_end, content_length) {
            if raw.len() >= he + cl {
                break;
            }
        }
        match stream.read(&mut chunk) {
            Ok(0) => break, // connection closed
            Ok(n) => {
                raw.extend_from_slice(&chunk[..n]);
                if header_end.is_none() {
                    if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                        header_end = Some(pos + 4);
                        let headers = String::from_utf8_lossy(&raw[..pos]);
                        for line in headers.lines() {
                            if let Some((name, value)) = line.split_once(':') {
                                if name.trim().eq_ignore_ascii_case("content-length") {
                                    content_length = value.trim().parse().ok();
                                }
                            }
                        }
                    }
                }
            }
            // A timeout/would-block after we already have data: use what we have.
            Err(e)
                if !raw.is_empty()
                    && matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
            {
                break
            }
            Err(e) => return Err(CdpError::new(format!("http read: {e}"))),
        }
    }

    let he = header_end.ok_or_else(|| CdpError::new("malformed HTTP response (no header end)"))?;
    Ok(String::from_utf8_lossy(&raw[he..]).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_renderer_by_filter() {
        let targets = vec![
            Target {
                id: "1".into(),
                kind: "page".into(),
                title: "Other".into(),
                url: "https://example.com".into(),
                ws_url: Some("ws://h:1/a".into()),
            },
            Target {
                id: "2".into(),
                kind: "page".into(),
                title: "SharedJSContext".into(),
                url: "https://steamloopback.host".into(),
                ws_url: Some("ws://h:1/b".into()),
            },
        ];
        assert_eq!(find_renderer(&targets, None).unwrap().id, "2");
        assert_eq!(find_renderer(&targets, Some("other")).unwrap().id, "1");
    }

    #[test]
    fn gamepad_ui_active_distinguishes_desktop_from_big_picture() {
        let t = |title: &str, url: &str| Target {
            id: "x".into(),
            kind: "page".into(),
            title: title.into(),
            url: url.into(),
            ws_url: Some("ws://h:1/a".into()),
        };
        // Desktop client alone → not the gamepad UI.
        let desktop = vec![
            t("Steam", "https://steamloopback.host/"),
            t(
                "SharedJSContext",
                "https://steamloopback.host/routes/library/home",
            ),
        ];
        assert!(!gamepad_ui_active(&desktop));
        // Big Picture window (gamepad user-agent) → gamepad UI active.
        let bp = vec![
            t(
                "Steam — Big Picture Mode",
                "about:blank?browser=-1&useragent=Valve%20Steam%20Gamepad",
            ),
            t(
                "SharedJSContext",
                "https://steamloopback.host/routes/library/home",
            ),
        ];
        assert!(gamepad_ui_active(&bp));
        // QuickAccess popup also counts.
        assert!(gamepad_ui_active(&[t(
            "QuickAccess_uid7",
            "about:blank?browserviewpopup=1"
        )]));
    }

    #[test]
    fn skips_targets_without_ws_url() {
        let targets = vec![Target {
            id: "1".into(),
            kind: "page".into(),
            title: "x".into(),
            url: "y".into(),
            ws_url: None,
        }];
        assert!(find_renderer(&targets, None).is_none());
    }

    #[test]
    fn detects_collapsed_ui_windows() {
        let shared = Target {
            id: "1".into(),
            kind: "page".into(),
            title: "SharedJSContext".into(),
            url: "https://steamloopback.host/routes/library/home".into(),
            ws_url: Some("ws://h:1/a".into()),
        };
        // Only SharedJSContext survives → UI windows collapsed (black screen).
        assert!(!ui_windows_present(std::slice::from_ref(&shared)));

        // With the Big Picture window present → UI is healthy.
        let big_picture = Target {
            id: "2".into(),
            kind: "page".into(),
            title: "Steam — Big Picture Mode".into(),
            url: "about:blank".into(),
            ws_url: Some("ws://h:1/b".into()),
        };
        assert!(ui_windows_present(&[shared, big_picture]));
    }
}
