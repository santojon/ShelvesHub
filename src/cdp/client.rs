//! The live CDP session: a single WebSocket connection to one target, with
//! command/response calls, fire-and-forget sends, JS evaluation and message
//! polling. Target discovery and the shared types live in the parent module.

use std::net::TcpStream;
use std::time::Duration;

use serde_json::{json, Value};
use tungstenite::client::IntoClientRequest;
use tungstenite::{Message, WebSocket};

use super::{discover_targets, find_renderer, CdpError, Result};

const WS_TIMEOUT: Duration = Duration::from_secs(10);

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
            .send(Message::Text(payload.to_string().into()))
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
            .send(Message::Text(payload.to_string().into()))
            .map_err(|e| CdpError::new(format!("send {method}: {e}")))?;
        Ok(id)
    }

    /// Like `send`, but routed to a flattened auto-attach session (adds
    /// `sessionId` so the browser connection forwards it to that page).
    pub fn send_on_session(
        &mut self,
        method: &str,
        params: Value,
        session_id: &str,
    ) -> Result<u64> {
        self.next_id += 1;
        let id = self.next_id;
        let payload =
            json!({ "id": id, "sessionId": session_id, "method": method, "params": params });
        self.socket
            .send(Message::Text(payload.to_string().into()))
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
                Ok(Message::Text(text)) => return Ok(text.to_string()),
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
}
