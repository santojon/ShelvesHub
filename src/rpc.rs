//! Host RPC server.
//!
//! A minimal blocking HTTP/1.1 server on localhost. The TypeScript
//! `ShelvesHostApi.rpc.call()` reaches it with a `fetch` POST of
//! `{ "method": "...", "args": ... }` and reads back `{ ok, result | error }`.
//!
//! HTTP (not raw TCP) because the caller lives inside the CEF renderer, where
//! `fetch` is the only available transport, and cross-origin requests need the
//! CORS headers we emit below. The body parsing is hand-rolled to avoid a full
//! HTTP-server dependency for three methods over loopback.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};

use serde_json::Value;

use crate::backend;
use crate::logger::{log_error, log_info, log_warning};
use crate::state;

pub fn serve(addr: &str) {
    let listener = match TcpListener::bind(addr) {
        Ok(l) => {
            log_info("rpc", &format!("Listening on {addr}"));
            l
        }
        Err(e) => {
            log_error("rpc", &format!("Failed to bind {addr}: {e}"));
            return;
        }
    };

    for stream in listener.incoming() {
        match stream {
            // One thread per connection: a slow data call proxied to the
            // Python backend must not block ping/version probes.
            Ok(s) => {
                std::thread::spawn(move || handle_connection(s));
            }
            Err(e) => log_warning("rpc", &format!("Accept error: {e}")),
        }
    }
}

fn handle_connection(mut stream: TcpStream) {
    let peer = stream
        .peer_addr()
        .map(|a| a.to_string())
        .unwrap_or_default();

    let request = match read_request(&stream) {
        Ok(req) => req,
        Err(e) => {
            log_warning("rpc", &format!("Bad request from {peer}: {e}"));
            let _ = write_response(&mut stream, 400, r#"{"ok":false,"error":"bad request"}"#);
            return;
        }
    };

    // CORS preflight from the renderer.
    if request.method == "OPTIONS" {
        let _ = write_response(&mut stream, 204, "");
        return;
    }

    let response_body = dispatch(&request.body);
    log_info(
        "rpc",
        &format!("{peer} -> {}", truncate_for_log(&request.body)),
    );
    if let Err(e) = write_response(&mut stream, 200, &response_body) {
        log_warning("rpc", &format!("Write error to {peer}: {e}"));
    }
}

struct HttpRequest {
    method: String,
    body: String,
}

/// Read request line + headers, then exactly `Content-Length` body bytes.
fn read_request(stream: &TcpStream) -> std::io::Result<HttpRequest> {
    let mut reader = BufReader::new(stream);

    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let method = request_line
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string();

    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
    }

    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body)?;
    }

    Ok(HttpRequest {
        method,
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

/// Keep journal lines sane: request bodies can be full settings documents.
fn truncate_for_log(body: &str) -> String {
    const MAX: usize = 300;
    if body.len() <= MAX {
        return body.to_string();
    }
    let cut = body
        .char_indices()
        .take_while(|(i, _)| *i < MAX)
        .last()
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(0);
    format!("{}… ({} bytes)", &body[..cut], body.len())
}

fn dispatch(body: &str) -> String {
    let parsed = serde_json::from_str::<Value>(body).ok();
    let method = parsed
        .as_ref()
        .and_then(|v| v.get("method").and_then(Value::as_str).map(str::to_string));

    match method.as_deref() {
        Some("ping") => ok(r#""pong""#.to_string()),
        Some("getVersion") => ok(format!(r#""{}""#, env!("CARGO_PKG_VERSION"))),
        Some("getHostApiVersion") => ok(format!(r#""{}""#, crate::HOST_API_VERSION)),
        Some("isInjected") => ok(state::is_injected().to_string()),
        // The bundle calls this once it has fully initialised against the host
        // API — record it as an explicit init confirmation from the bundle side.
        Some("bundleReady") => {
            state::set_bundle_ready(true);
            log_info("rpc", "Bundle reported ready (initialisation confirmed).");
            ok("true".to_string())
        }
        // Health of the hosted Python backend (loader-local, not proxied).
        Some("getBackendStatus") => ok(format!(
            r#"{{"configured":{},"running":{}}}"#,
            backend::enabled(),
            backend::is_running()
        )),
        // Manual bundle re-download (the fallback panel's "download" action):
        // fetch the newest release into the bundle path; the loop re-injects it.
        Some("populateBundle") => match state::populate_config() {
            Some((path, prerelease)) => {
                match crate::populate::update_from_release(path, *prerelease) {
                    Ok(url) => {
                        log_info("rpc", &format!("Bundle re-downloaded: {url}"));
                        ok(serde_json::Value::String(url).to_string())
                    }
                    Err(e) => err(&e),
                }
            }
            None => err("bundle path not configured"),
        },
        // Anything else is a data method owned by the hosted Python backend.
        Some(other) if backend::enabled() => {
            let args = parsed
                .as_ref()
                .and_then(|v| v.get("args").cloned())
                .unwrap_or(Value::Null);
            match backend::call(other, &args) {
                Ok(result) => ok(result.to_string()),
                Err(message) => err(&message),
            }
        }
        Some(other) => err(&format!("unknown method: {other}")),
        None => err("missing or invalid method"),
    }
}

fn ok(result_json: String) -> String {
    format!(r#"{{"ok":true,"result":{result_json}}}"#)
}

fn err(message: &str) -> String {
    let escaped = message.replace('\\', "\\\\").replace('"', "\\\"");
    format!(r#"{{"ok":false,"error":"{escaped}"}}"#)
}

fn write_response(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        _ => "OK",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {len}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        len = body.len()
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatches_ping() {
        assert_eq!(
            dispatch(r#"{"method":"ping"}"#),
            r#"{"ok":true,"result":"pong"}"#
        );
    }

    #[test]
    fn dispatches_is_injected() {
        state::set_injected(false);
        assert_eq!(
            dispatch(r#"{"method":"isInjected"}"#),
            r#"{"ok":true,"result":false}"#
        );
    }

    #[test]
    fn dispatches_host_api_version() {
        assert_eq!(
            dispatch(r#"{"method":"getHostApiVersion"}"#),
            format!(r#"{{"ok":true,"result":"{}"}}"#, crate::HOST_API_VERSION)
        );
    }

    #[test]
    fn dispatches_bundle_ready() {
        state::set_bundle_ready(false);
        assert_eq!(
            dispatch(r#"{"method":"bundleReady"}"#),
            r#"{"ok":true,"result":true}"#
        );
        assert!(state::is_bundle_ready());
    }

    #[test]
    fn rejects_unknown_method() {
        assert_eq!(
            dispatch(r#"{"method":"nope"}"#),
            r#"{"ok":false,"error":"unknown method: nope"}"#
        );
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(
            dispatch("not json"),
            r#"{"ok":false,"error":"missing or invalid method"}"#
        );
    }
}
