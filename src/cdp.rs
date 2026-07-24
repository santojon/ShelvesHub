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

use std::fmt;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tungstenite::client::IntoClientRequest;
use tungstenite::{Message, WebSocket};

const HTTP_TIMEOUT: Duration = Duration::from_secs(5);
const WS_TIMEOUT: Duration = Duration::from_secs(10);

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
    fn new(msg: impl Into<String>) -> Self {
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
    let v: Value =
        serde_json::from_str(&body).map_err(|e| CdpError::new(format!("parse /json/version: {e}")))?;
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
    const STEAM_HINTS: [&str; 4] =
        ["sharedjscontext", "steamloopback.host", "steamui", "big picture"];

    for hint in STEAM_HINTS {
        let found = targets.iter().filter(has_ws).find(|t| {
            t.title.to_lowercase().contains(hint) || t.url.to_lowercase().contains(hint)
        });
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

/// A live CDP session over a single WebSocket connection.
pub struct CdpClient {
    socket: WebSocket<TcpStream>,
    next_id: u64,
}

impl CdpClient {
    /// Open a session against a target's `webSocketDebuggerUrl`.
    pub fn connect(ws_url: &str) -> Result<Self> {
        let (host, port) = parse_ws_authority(ws_url)?;
        let stream = TcpStream::connect((host.as_str(), port))
            .map_err(|e| CdpError::new(format!("tcp connect {host}:{port}: {e}")))?;
        stream
            .set_read_timeout(Some(WS_TIMEOUT))
            .map_err(|e| CdpError::new(format!("set read timeout: {e}")))?;
        stream
            .set_write_timeout(Some(WS_TIMEOUT))
            .map_err(|e| CdpError::new(format!("set write timeout: {e}")))?;

        let request = ws_url
            .into_client_request()
            .map_err(|e| CdpError::new(format!("ws request: {e}")))?;
        let (socket, _resp) = tungstenite::client::client(request, stream)
            .map_err(|e| CdpError::new(format!("ws handshake: {e}")))?;

        Ok(CdpClient { socket, next_id: 0 })
    }

    /// Discover targets and connect to the chosen renderer in one step.
    pub fn connect_renderer(host: &str, port: u16, filter: Option<&str>) -> Result<Self> {
        let targets = discover_targets(host, port)?;
        let target = find_renderer(&targets, filter)
            .ok_or_else(|| CdpError::new("no suitable DevTools target found"))?;
        let ws_url = target
            .ws_url
            .as_deref()
            .ok_or_else(|| CdpError::new("target has no webSocketDebuggerUrl"))?;
        Self::connect(ws_url)
    }

    /// Send a CDP command and block until its matching response arrives.
    /// Unsolicited events received while waiting are discarded.
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value> {
        self.next_id += 1;
        let id = self.next_id;
        let payload = json!({ "id": id, "method": method, "params": params });
        self.socket
            .send(Message::Text(payload.to_string()))
            .map_err(|e| CdpError::new(format!("send {method}: {e}")))?;

        loop {
            let msg = self.read_text()?;
            let value: Value = serde_json::from_str(&msg)
                .map_err(|e| CdpError::new(format!("parse response: {e}")))?;

            // Skip events (they have no matching "id").
            if value.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }

            if let Some(err) = value.get("error") {
                return Err(CdpError::new(format!("{method}: {err}")));
            }
            return Ok(value.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    /// Send a command without waiting for its response (fire-and-forget); the
    /// caller drains responses/events via `poll_message`. Returns the id used.
    pub fn send(&mut self, method: &str, params: Value) -> Result<u64> {
        self.next_id += 1;
        let id = self.next_id;
        let payload = json!({ "id": id, "method": method, "params": params });
        self.socket
            .send(Message::Text(payload.to_string()))
            .map_err(|e| CdpError::new(format!("send {method}: {e}")))?;
        Ok(id)
    }

    /// Like `send`, but routed to a flattened auto-attach session (adds
    /// `sessionId` so the browser connection forwards it to that page).
    pub fn send_on_session(&mut self, method: &str, params: Value, session_id: &str) -> Result<u64> {
        self.next_id += 1;
        let id = self.next_id;
        let payload = json!({ "id": id, "sessionId": session_id, "method": method, "params": params });
        self.socket
            .send(Message::Text(payload.to_string()))
            .map_err(|e| CdpError::new(format!("send {method}: {e}")))?;
        Ok(id)
    }

    /// Evaluate a JavaScript expression in the renderer's main context and
    /// return its value (`returnByValue`). Awaits promises and surfaces
    /// uncaught exceptions as errors.
    pub fn evaluate(&mut self, expression: &str) -> Result<Value> {
        let params = json!({
            "expression": expression,
            "returnByValue": true,
            "awaitPromise": true,
            "userGesture": true,
        });
        let result = self.call("Runtime.evaluate", params)?;

        if let Some(details) = result.get("exceptionDetails") {
            let text = details
                .get("exception")
                .and_then(|e| e.get("description"))
                .and_then(Value::as_str)
                .or_else(|| details.get("text").and_then(Value::as_str))
                .unwrap_or("uncaught exception");
            return Err(CdpError::new(format!("evaluate: {text}")));
        }

        Ok(result
            .get("result")
            .and_then(|r| r.get("value"))
            .cloned()
            .unwrap_or(Value::Null))
    }

    /// Read the next raw CDP message (command response or event) as JSON.
    /// Useful for streaming console output. Returns `None` on a read timeout
    /// so callers can poll without blocking forever.
    pub fn poll_message(&mut self) -> Result<Option<Value>> {
        match self.socket.read() {
            Ok(Message::Text(text)) => serde_json::from_str(&text)
                .map(Some)
                .map_err(|e| CdpError::new(format!("parse message: {e}"))),
            Ok(Message::Close(_)) => Err(CdpError::new("connection closed")),
            Ok(_) => Ok(None), // ping/pong/binary — ignore
            Err(tungstenite::Error::Io(e))
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                Ok(None)
            }
            Err(e) => Err(CdpError::new(format!("read: {e}"))),
        }
    }

    fn read_text(&mut self) -> Result<String> {
        loop {
            match self.socket.read() {
                Ok(Message::Text(text)) => return Ok(text),
                Ok(Message::Close(_)) => return Err(CdpError::new("connection closed")),
                Ok(_) => continue, // ping/pong/binary — keep reading
                Err(e) => return Err(CdpError::new(format!("read: {e}"))),
            }
        }
    }
}

/// Parse `ws://host:port/path` into `(host, port)`.
fn parse_ws_authority(ws_url: &str) -> Result<(String, u16)> {
    let rest = ws_url
        .strip_prefix("ws://")
        .or_else(|| ws_url.strip_prefix("wss://"))
        .ok_or_else(|| CdpError::new(format!("not a ws url: {ws_url}")))?;
    let authority = rest.split('/').next().unwrap_or(rest);
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (
            h.to_string(),
            p.parse()
                .map_err(|_| CdpError::new(format!("bad port in {ws_url}")))?,
        ),
        None => (authority.to_string(), 80),
    };
    Ok((host, port))
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
    fn parses_ws_authority() {
        assert_eq!(
            parse_ws_authority("ws://127.0.0.1:8080/devtools/page/AB").unwrap(),
            ("127.0.0.1".to_string(), 8080)
        );
    }

    #[test]
    fn rejects_non_ws_url() {
        assert!(parse_ws_authority("http://x").is_err());
    }

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
}
