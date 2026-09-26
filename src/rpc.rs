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
use std::time::Duration;

/// Reject bodies larger than this (a settings document is a few KiB) — bounds the
/// per-connection allocation so a bogus Content-Length can't exhaust memory.
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
/// Per-connection read timeout: a slow/stalled client (slowloris) is dropped
/// instead of holding a thread forever.
const READ_TIMEOUT: Duration = Duration::from_secs(15);

use serde_json::Value;

use crate::backend;
use crate::logger::{log_error, log_info, log_warning};
use crate::state;

/// Operational-config keys the "advanced configuration" editor may change. The
/// rest (host/port/paths) stay read-only — editing them can cut the panel off
/// from the daemon. All apply on the next restart. `recover_cmd` is deliberately
/// NOT here: it runs through a shell on a UI-collapse event, so letting the RPC
/// (reachable by any local caller) set it would be arbitrary code execution — it
/// is file/env only.
const EDITABLE_CONFIG_KEYS: [&str; 6] = [
    "native_qam",
    "prerelease",
    "owner_settle_secs",
    "interval_secs",
    "force_owner",
    "desktop_ui",
];

/// The ONLY method names proxied to the Python backend — the Deck Shelves plugin's
/// public API. The runner resolves any public attribute by name, so without this
/// the proxy would be a generic gateway to arbitrary Python calls; anything not
/// here answers "unknown method". (Path-safety of the file methods is jailed on
/// the plugin side; this bounds the callable surface to the real API.)
const BACKEND_METHODS: [&str; 31] = [
    "clear_backups",
    "create_backup",
    "delete_backup",
    "download_release",
    "export_backup",
    "export_settings",
    "get_audio_state",
    "get_bluetooth_state",
    "get_css_loader_themes",
    "get_display_state",
    "get_hardware_info",
    "get_host_os",
    "get_library_locations",
    "get_perf_snapshot",
    "get_settings",
    "get_tabmaster_tabs",
    "get_user_desktop",
    "get_user_home",
    "get_user_pictures",
    "get_wishlist",
    "import_backup",
    "import_settings",
    "list_available_launchers",
    "list_backups",
    "list_launcher_games",
    "read_image_b64",
    "read_json_file",
    "reset_settings",
    "restore_backup",
    "set_settings",
    "write_json_file",
];

pub fn serve(addr: &str) {
    let listener = match TcpListener::bind(addr) {
        Ok(l) => {
            log_info("rpc", &format!("Listening on {addr}"));
            l
        }
        Err(e) => {
            // A dead RPC means the runtime can't save settings — a silent
            // data-loss risk. Make it loud and actionable rather than a lone line.
            log_error(
                "rpc",
                &format!(
                    "Failed to bind the control endpoint {addr}: {e}. Another process (a \
                     second ShelvesHub, or something else) holds the port, so settings CANNOT \
                     be saved. Stop the other process, or set `rpc_port` in shelveshub.config.json \
                     to a free port, then restart the service."
                ),
            );
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
    // Slowloris guard: drop a client that stalls mid-request.
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));

    let request = match read_request(&stream) {
        Ok(req) => req,
        Err(e) => {
            log_warning("rpc", &format!("Bad request from {peer}: {e}"));
            let _ = write_response(
                &mut stream,
                400,
                r#"{"ok":false,"error":"bad request"}"#,
                None,
            );
            return;
        }
    };

    // CORS: reflect a real Origin only — never `*`. The per-boot token is the
    // actual gate; reflecting the origin just lets the legitimate runtime read
    // the response from whichever Steam document it runs in.
    let origin = request.origin.as_deref();

    // CORS preflight from the renderer — grant the headers the real call needs.
    if request.method == "OPTIONS" {
        let _ = write_response(&mut stream, 204, "", origin);
        return;
    }

    if request.too_large {
        let _ = write_response(
            &mut stream,
            413,
            r#"{"ok":false,"error":"request too large"}"#,
            origin,
        );
        return;
    }

    // Require a JSON content-type. A cross-origin "simple request" (text/plain or
    // a form) can't set this without a CORS preflight, so this blocks a malicious
    // page from triggering side effects fire-and-forget.
    let is_json = request
        .content_type
        .as_deref()
        .is_some_and(|c| c.to_ascii_lowercase().starts_with("application/json"));
    if !is_json {
        let _ = write_response(
            &mut stream,
            415,
            r#"{"ok":false,"error":"Content-Type: application/json required"}"#,
            origin,
        );
        return;
    }

    // Require the per-boot bearer token (only the daemon can stamp it into the
    // runtime over CDP). No token / wrong token → 401, before any dispatch.
    let authorized = request
        .authorization
        .as_deref()
        .and_then(|a| a.strip_prefix("Bearer "))
        .is_some_and(|t| constant_time_eq(t.as_bytes(), state::rpc_token().as_bytes()));
    if !authorized {
        let _ = write_response(
            &mut stream,
            401,
            r#"{"ok":false,"error":"unauthorized"}"#,
            origin,
        );
        return;
    }

    let response_body = dispatch(&request.body);
    log_info(
        "rpc",
        &format!("{peer} -> {}", truncate_for_log(&request.body)),
    );
    if let Err(e) = write_response(&mut stream, 200, &response_body, origin) {
        log_warning("rpc", &format!("Write error to {peer}: {e}"));
    }
}

/// Length-independent byte compare, so token validation doesn't leak length or
/// prefix via timing.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

struct HttpRequest {
    method: String,
    body: String,
    origin: Option<String>,
    authorization: Option<String>,
    content_type: Option<String>,
    /// Content-Length exceeded `MAX_BODY_BYTES` — the body was not read.
    too_large: bool,
}

/// Read request line + headers, then exactly `Content-Length` body bytes (capped).
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
    let mut origin = None;
    let mut authorization = None;
    let mut content_type = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim();
            let value = value.trim().to_string();
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.parse().unwrap_or(0);
            } else if name.eq_ignore_ascii_case("origin") {
                origin = Some(value);
            } else if name.eq_ignore_ascii_case("authorization") {
                authorization = Some(value);
            } else if name.eq_ignore_ascii_case("content-type") {
                content_type = Some(value);
            }
        }
    }

    if content_length > MAX_BODY_BYTES {
        return Ok(HttpRequest {
            method,
            body: String::new(),
            origin,
            authorization,
            content_type,
            too_large: true,
        });
    }

    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body)?;
    }

    Ok(HttpRequest {
        method,
        body: String::from_utf8_lossy(&body).into_owned(),
        origin,
        authorization,
        content_type,
        too_large: false,
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

/// Record the newest release tag as the installed `bundle_tag` after a download,
/// so the "update available" check resolves. Without this a manual/host-driven
/// update re-downloads every cycle and the plugin's update banner never clears.
fn record_bundle_tag(prerelease: bool) {
    let Some(tag) = crate::populate::latest_release_tag(prerelease) else {
        return;
    };
    let Some(cfg_path) = crate::state::hub_config_path() else {
        return;
    };
    let mut s = crate::store::load(cfg_path);
    if s.bundle_tag != tag {
        s.bundle_tag = tag;
        let _ = crate::store::save(cfg_path, &s);
    }
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
            match state::millis_since_injected() {
                Some(ms) => log_info(
                    "rpc",
                    &format!(
                        "Bundle reported ready (initialisation confirmed) — {ms}ms after injection."
                    ),
                ),
                None => log_info("rpc", "Bundle reported ready (initialisation confirmed)."),
            }
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
                        record_bundle_tag(*prerelease);
                        log_info("rpc", &format!("Bundle re-downloaded: {url}"));
                        ok(serde_json::Value::String(url).to_string())
                    }
                    Err(e) => err(&e),
                }
            }
            None => err("bundle path not configured"),
        },
        // Host self-install of a PLUGIN update (`host.updates.applyUpdate`): obtain the
        // given release asset (or the newest) and swap the injected bundle in place; the
        // renderer reload the runtime triggers afterwards re-boots the plugin on it.
        Some("applyUpdate") => match state::populate_config() {
            Some((path, prerelease)) => {
                let asset_url = parsed
                    .as_ref()
                    .and_then(|v| v.get("args"))
                    .and_then(|a| a.get("assetUrl"))
                    .and_then(Value::as_str);
                match crate::populate::apply_update(path, asset_url, *prerelease) {
                    Ok(url) => {
                        record_bundle_tag(*prerelease);
                        log_info("rpc", &format!("Applied plugin update: {url}"));
                        ok(r#"{"applied":true}"#.to_string())
                    }
                    Err(e) => {
                        log_error("rpc", &format!("applyUpdate failed: {e}"));
                        err(&e)
                    }
                }
            }
            None => err("bundle path not configured"),
        },
        // The host's own settings (the fallback panel's auto-update toggle).
        Some("getConfig") => match state::hub_config_path() {
            Some(path) => match serde_json::to_value(crate::store::load(path)) {
                Ok(mut v) => {
                    // Merge in the runtime-only "restart to update" notice (the hub
                    // has a newer release but can't self-replace its running binary
                    // yet) so the hub screen can surface it. `null` = none.
                    if let Some(obj) = v.as_object_mut() {
                        obj.insert(
                            "pending_hub_update".to_string(),
                            state::pending_hub_update().map_or(Value::Null, Value::String),
                        );
                        obj.insert(
                            "hub_update_staged".to_string(),
                            Value::Bool(state::hub_update_staged()),
                        );
                        obj.insert("paused".to_string(), Value::Bool(state::hosting_paused()));
                        obj.insert(
                            "version".to_string(),
                            Value::String(env!("CARGO_PKG_VERSION").to_string()),
                        );
                    }
                    ok(v.to_string())
                }
                Err(e) => err(&format!("serialize config: {e}")),
            },
            None => err("hub config path not configured"),
        },
        Some("setAutoUpdate") => match state::hub_config_path() {
            Some(path) => {
                let enabled = parsed
                    .as_ref()
                    .and_then(|v| v.get("args"))
                    .and_then(|a| {
                        a.as_bool()
                            .or_else(|| a.get("enabled").and_then(Value::as_bool))
                    })
                    .unwrap_or(false);
                let mut settings = crate::store::load(path);
                settings.auto_update = enabled;
                match crate::store::save(path, &settings) {
                    Ok(()) => {
                        log_info("rpc", &format!("Auto-update set to {enabled}."));
                        match serde_json::to_string(&settings) {
                            Ok(json) => ok(json),
                            Err(e) => err(&format!("serialize config: {e}")),
                        }
                    }
                    Err(e) => {
                        log_error("rpc", &format!("save config failed: {e}"));
                        err(&format!("save config: {e}"))
                    }
                }
            }
            None => err("hub config path not configured"),
        },
        // Set one of the nested update-preference switches by key (the fallback
        // panel's update hierarchy). Args: `{ key, value }`. Unknown keys are
        // rejected so a typo can never silently no-op.
        Some("setUpdatePref") => match state::hub_config_path() {
            Some(path) => {
                let args = parsed.as_ref().and_then(|v| v.get("args"));
                let key = args.and_then(|a| a.get("key")).and_then(Value::as_str);
                let value = args
                    .and_then(|a| a.get("value"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let mut settings = crate::store::load(path);
                let applied = match key {
                    Some("auto_update") => {
                        settings.auto_update = value;
                        true
                    }
                    Some("auto_update_hub") => {
                        settings.auto_update_hub = value;
                        true
                    }
                    Some("hub_prerelease") => {
                        settings.hub_prerelease = value;
                        true
                    }
                    Some("auto_update_plugin") => {
                        settings.auto_update_plugin = value;
                        true
                    }
                    Some("plugin_prerelease") => {
                        settings.plugin_prerelease = value;
                        true
                    }
                    _ => false,
                };
                if !applied {
                    return err(&format!("unknown update pref key: {key:?}"));
                }
                match crate::store::save(path, &settings) {
                    Ok(()) => {
                        log_info("rpc", &format!("Update pref {key:?} set to {value}."));
                        match serde_json::to_string(&settings) {
                            Ok(json) => ok(json),
                            Err(e) => err(&format!("serialize config: {e}")),
                        }
                    }
                    Err(e) => {
                        log_error("rpc", &format!("save config failed: {e}"));
                        err(&format!("save config: {e}"))
                    }
                }
            }
            None => err("hub config path not configured"),
        },
        // Recent daemon log lines (the fallback panel's "view logs" action).
        Some("getLogs") => {
            let n = parsed
                .as_ref()
                .and_then(|v| v.get("args"))
                .and_then(|a| {
                    a.as_u64()
                        .or_else(|| a.get("count").and_then(Value::as_u64))
                })
                .unwrap_or(120)
                .min(300) as usize;
            match serde_json::to_string(&state::recent_logs(n)) {
                Ok(json) => ok(json),
                Err(e) => err(&format!("serialize logs: {e}")),
            }
        }
        // Clear the in-memory log ring the viewer shows (the fallback panel's
        // Clear action). The on-disk daemon log is left intact.
        Some("clearLogs") => {
            state::clear_logs();
            ok("true".to_string())
        }
        // Troubleshooting: pause/resume hosting until the next service restart.
        // Args: a bool (or `{ paused }`). In-memory, so a restart always resumes.
        Some("setHostingPaused") => {
            let paused = parsed
                .as_ref()
                .and_then(|v| v.get("args"))
                .and_then(|a| {
                    a.as_bool()
                        .or_else(|| a.get("paused").and_then(Value::as_bool))
                })
                .unwrap_or(false);
            state::set_hosting_paused(paused);
            log_info("rpc", &format!("Hosting paused set to {paused}."));
            ok(format!(r#"{{"paused":{paused}}}"#))
        }
        // Optional boot animation: a live on/off toggle (not a restart-required
        // config value). Args: a bool (or `{ enabled }`). Turning it on installs
        // the bundled startup movie into Steam's slot immediately; off removes it.
        // The choice is persisted to the config file so it survives a restart.
        Some("setBootMovie") => {
            let enabled = parsed
                .as_ref()
                .and_then(|v| v.get("args"))
                .and_then(|a| {
                    a.as_bool()
                        .or_else(|| a.get("enabled").and_then(Value::as_bool))
                })
                .unwrap_or(false);
            let Some(source) = state::boot_movie_source() else {
                return err("boot movie source not known");
            };
            match crate::bootmovie::apply(enabled, source) {
                Ok(_) => {
                    state::set_boot_movie_enabled(enabled);
                    // Persist to the config file so the choice survives a restart.
                    if let Some(path) = state::config_file_path() {
                        let mut obj = std::fs::read_to_string(path)
                            .ok()
                            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                            .and_then(|v| v.as_object().cloned())
                            .unwrap_or_default();
                        obj.insert("boot_movie".to_string(), Value::Bool(enabled));
                        if let Ok(out) = serde_json::to_string_pretty(&Value::Object(obj)) {
                            let _ = std::fs::write(path, out);
                        }
                    }
                    log_info("rpc", &format!("Boot movie set to {enabled}."));
                    ok(format!(r#"{{"boot_movie":{enabled}}}"#))
                }
                Err(e) => {
                    log_error("rpc", &format!("setBootMovie failed: {e}"));
                    err(&e)
                }
            }
        }
        // Advanced configuration mirror (read): the effective operational config +
        // which keys are editable + live state (paused / pending hub update).
        Some("getRuntimeConfig") => {
            let mut v = state::runtime_config().cloned().unwrap_or(Value::Null);
            if let Some(obj) = v.as_object_mut() {
                obj.insert(
                    "editable".to_string(),
                    serde_json::json!(EDITABLE_CONFIG_KEYS),
                );
                obj.insert("paused".to_string(), Value::Bool(state::hosting_paused()));
                // Live boot-animation state (toggled without a restart) overrides
                // the boot snapshot so the hub screen echoes the current on/off.
                obj.insert(
                    "boot_movie".to_string(),
                    Value::Bool(state::boot_movie_enabled()),
                );
                obj.insert(
                    "pending_hub_update".to_string(),
                    state::pending_hub_update().map_or(Value::Null, Value::String),
                );
                obj.insert(
                    "hub_update_staged".to_string(),
                    Value::Bool(state::hub_update_staged()),
                );
                obj.insert(
                    "config_file".to_string(),
                    state::config_file_path()
                        .map_or(Value::Null, |p| Value::String(p.display().to_string())),
                );
            }
            ok(v.to_string())
        }
        // Advanced configuration mirror (write): set ONE safe operational-config
        // key in the config file. Args: `{ key, value }`. Applies on next restart;
        // read-only/unknown keys and wrong value types are refused.
        Some("setRuntimeConfig") => {
            let args = parsed.as_ref().and_then(|v| v.get("args"));
            let key = args.and_then(|a| a.get("key")).and_then(Value::as_str);
            let value = args
                .and_then(|a| a.get("value"))
                .cloned()
                .unwrap_or(Value::Null);
            let key = match key {
                Some(k) if EDITABLE_CONFIG_KEYS.contains(&k) => k,
                other => return err(&format!("refused config key (not editable): {other:?}")),
            };
            let coerced = match key {
                "native_qam" | "prerelease" | "force_owner" | "desktop_ui" => {
                    value.as_bool().map(Value::Bool)
                }
                "owner_settle_secs" | "interval_secs" => value.as_u64().map(Value::from),
                "recover_cmd" => match &value {
                    Value::Null => Some(Value::Null),
                    Value::String(s) if s.is_empty() => Some(Value::Null),
                    Value::String(s) => Some(Value::String(s.clone())),
                    _ => None,
                },
                _ => None,
            };
            let Some(coerced) = coerced else {
                return err(&format!("invalid value type for {key}"));
            };
            let Some(path) = state::config_file_path() else {
                return err("config file path not known");
            };
            // Read-merge-write the config file (create if absent), preserving other
            // keys (comments included). Values apply on the next daemon restart.
            let mut obj = std::fs::read_to_string(path)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .and_then(|v| v.as_object().cloned())
                .unwrap_or_default();
            obj.insert(key.to_string(), coerced);
            let out = serde_json::to_string_pretty(&Value::Object(obj))
                .unwrap_or_else(|_| "{}".to_string());
            match std::fs::write(path, out) {
                Ok(()) => {
                    log_info(
                        "rpc",
                        &format!("Config file updated: {key} (restart to apply)."),
                    );
                    ok(r#"{"ok":true,"restartRequired":true}"#.to_string())
                }
                Err(e) => {
                    log_error("rpc", &format!("write config file: {e}"));
                    err(&format!("write config file: {e}"))
                }
            }
        }
        // Host runtime forwards its own leveled/scoped log entries here so the
        // log viewer shows one merged stream (daemon + runtime). Args is an array
        // of `{ level, scope, msg, t }`; each becomes a formatted ring line.
        Some("pushLogs") => {
            let mut n: u64 = 0;
            if let Some(arr) = parsed
                .as_ref()
                .and_then(|v| v.get("args"))
                .and_then(Value::as_array)
            {
                for e in arr {
                    let level = match e.get("level").and_then(Value::as_str) {
                        Some("ERROR") | Some("error") => crate::logger::LogLevel::Error,
                        Some("WARN") | Some("warn") => crate::logger::LogLevel::Warn,
                        _ => crate::logger::LogLevel::Info,
                    };
                    let scope = e.get("scope").and_then(Value::as_str).unwrap_or("UI");
                    let msg = e
                        .get("msg")
                        .and_then(Value::as_str)
                        .or_else(|| e.get("message").and_then(Value::as_str))
                        .unwrap_or("");
                    let t_ms = e.get("t").and_then(Value::as_i64);
                    crate::logger::log_runtime(level, scope, msg, t_ms);
                    n += 1;
                }
            }
            ok(n.to_string())
        }
        // Update ShelvesHub itself: download the newest release package for this
        // OS and stage its binary over the running one (see populate::apply_hub_update).
        // A running binary can't be swapped live, so this takes effect on restart —
        // when running under a relaunching service manager the daemon restarts itself
        // (respond first, then exit); otherwise the "restart to apply" notice stands.
        Some("selfUpdate") => {
            let prerelease = state::hub_config_path()
                .map(|p| crate::store::load(p).hub_prerelease)
                .unwrap_or(false);
            match crate::populate::apply_hub_update(prerelease) {
                Ok(tag) => {
                    state::set_hub_update_staged(true);
                    state::set_pending_hub_update(Some(tag.clone()));
                    let restarting = crate::populate::under_relaunching_service();
                    log_info(
                        "rpc",
                        &format!("Hub self-update {tag} staged (restarting={restarting})."),
                    );
                    if restarting {
                        // Exit after the response flushes so the service manager
                        // relaunches into the staged binary. The renderer keeps the
                        // current runtime until the new daemon re-injects.
                        std::thread::spawn(|| {
                            std::thread::sleep(std::time::Duration::from_millis(1500));
                            log_info("rpc", "Restarting to apply hub update.");
                            std::process::exit(0);
                        });
                    }
                    ok(format!(
                        r#"{{"updated":true,"restarting":{restarting},"version":"{}","tag":"{}"}}"#,
                        env!("CARGO_PKG_VERSION"),
                        tag.replace('"', "'")
                    ))
                }
                Err(e) => {
                    log_error("rpc", &format!("selfUpdate failed: {e}"));
                    err(&e)
                }
            }
        }
        // Restart the daemon so pending config-file edits (interval, native_qam,
        // owner_settle, force_owner, …) take effect — they are only read at startup.
        // Under a relaunching service manager the daemon exits (after the response
        // flushes) and the manager relaunches a fresh process that re-reads the
        // config; otherwise the "restart to apply" notice stands. The renderer
        // restart (for owner claiming on a fresh boot) is the caller's job.
        Some("restartService") => {
            let restarting = crate::populate::under_relaunching_service();
            log_info(
                "rpc",
                &format!("Service restart requested to apply config (restarting={restarting})."),
            );
            if restarting {
                std::thread::spawn(|| {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    log_info("rpc", "Restarting to apply configuration.");
                    std::process::exit(0);
                });
            }
            ok(format!(r#"{{"restarting":{restarting}}}"#))
        }
        // A data method owned by the hosted Python backend — only if it's in the
        // known API allowlist (else it falls through to "unknown method" below).
        Some(other) if backend::enabled() && BACKEND_METHODS.contains(&other) => {
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

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    body: &str,
    origin: Option<&str>,
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        _ => "OK",
    };
    // Reflect a real Origin (never `*`); omit ACAO entirely when there is none.
    let cors_origin = match origin {
        Some(o) => format!("Access-Control-Allow-Origin: {o}\r\nVary: Origin\r\n"),
        None => String::new(),
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {len}\r\n\
         {cors_origin}\
         Access-Control-Allow-Methods: POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, Authorization\r\n\
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
    fn constant_time_eq_matches_only_equal() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(constant_time_eq(b"", b""));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
        assert!(!constant_time_eq(b"", b"x"));
    }

    #[test]
    fn recover_cmd_is_not_rpc_editable() {
        // recover_cmd runs through a shell — it must never be settable over RPC.
        assert!(!EDITABLE_CONFIG_KEYS.contains(&"recover_cmd"));
    }

    #[test]
    fn backend_proxy_allowlist_bounds_the_surface() {
        // Real API methods pass; arbitrary Python attributes do not.
        assert!(BACKEND_METHODS.contains(&"get_settings"));
        assert!(BACKEND_METHODS.contains(&"write_json_file"));
        assert!(!BACKEND_METHODS.contains(&"os.system"));
        assert!(!BACKEND_METHODS.contains(&"__import__"));
        assert!(!BACKEND_METHODS.contains(&"eval"));
    }

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
