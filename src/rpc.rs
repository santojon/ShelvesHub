use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};

use crate::logger::{log_info, log_warning, log_error};

const RPC_ADDR: &str = "127.0.0.1:57381";

/// Blocking TCP RPC server.
///
/// Each connection receives one newline-delimited JSON request and responds
/// with one newline-delimited JSON reply. This is intentionally minimal — the
/// shape matches the IPC contract used by the TypeScript `RpcApi` in
/// `src/runtime/host/contract.ts` so the TS side can call into the host
/// process over localhost without any native addon.
///
/// Replace the stub dispatch table with real CEF / Steam client integration
/// once the bundle injection mechanism is proven.
pub fn serve() {
    let listener = match TcpListener::bind(RPC_ADDR) {
        Ok(l) => {
            log_info("rpc", &format!("Listening on {}", RPC_ADDR));
            l
        }
        Err(e) => {
            log_error("rpc", &format!("Failed to bind {}: {}", RPC_ADDR, e));
            return;
        }
    };

    for stream in listener.incoming() {
        match stream {
            Ok(s) => handle_connection(s),
            Err(e) => log_warning("rpc", &format!("Accept error: {}", e)),
        }
    }
}

fn handle_connection(mut stream: TcpStream) {
    let peer = stream.peer_addr().map(|a| a.to_string()).unwrap_or_default();
    log_info("rpc", &format!("Connection from {}", peer));

    let reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(e) => {
            log_error("rpc", &format!("Failed to clone stream: {}", e));
            return;
        }
    });

    for line in reader.lines() {
        let request = match line {
            Ok(l) if !l.trim().is_empty() => l,
            Ok(_) => continue,
            Err(e) => {
                log_warning("rpc", &format!("Read error from {}: {}", peer, e));
                break;
            }
        };

        log_info("rpc", &format!("Request from {}: {}", peer, request));
        let response = dispatch(&request);

        if let Err(e) = writeln!(stream, "{}", response) {
            log_warning("rpc", &format!("Write error to {}: {}", peer, e));
            break;
        }
    }

    log_info("rpc", &format!("Connection closed: {}", peer));
}

fn dispatch(request: &str) -> String {
    // Minimal JSON parsing without an external crate — good enough for the
    // stub stage. Replace with serde_json once the real method table is known.
    if request.contains("\"method\":\"ping\"") {
        return r#"{"ok":true,"result":"pong"}"#.to_string();
    }
    if request.contains("\"method\":\"getVersion\"") {
        return format!(r#"{{"ok":true,"result":"{}"}}"#, env!("CARGO_PKG_VERSION"));
    }
    if request.contains("\"method\":\"isInjected\"") {
        // TODO: forward to the real injection state.
        return r#"{"ok":true,"result":false}"#.to_string();
    }

    r#"{"ok":false,"error":"unknown method"}"#.to_string()
}
