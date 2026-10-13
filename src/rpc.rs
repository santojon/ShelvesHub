//! Host RPC server.
//!
//! A minimal blocking HTTP/1.1 server on localhost. The TypeScript
//! `ShelvesHostApi.rpc.call()` reaches it with a `fetch` POST of
//! `{ "method": "...", "args": ... }` and reads back `{ ok, result | error }`.
//!
//! HTTP (not raw TCP) because the caller lives inside the CEF renderer, where
//! `fetch` is the only available transport, and cross-origin requests need the
//! CORS headers we emit below. The body parsing is hand-rolled to avoid a full
//! HTTP-server dependency for a small, fixed method set over loopback.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

use crate::constants::defaults::MAX_BODY_BYTES;
use crate::constants::timers::READ_TIMEOUT;
use crate::constants::urls::TRUSTED_BUNDLE_PREFIX;

use serde_json::Value;

use crate::backend;
use crate::logger::{log_error, log_info, log_warning};
use crate::semver::version_is_newer;
use crate::state;

/// Operational-config keys the "advanced configuration" editor may change. The
/// rest (host/port/paths) stay read-only — editing them can cut the panel off
/// from the daemon. All apply on the next restart. `recover_cmd` is deliberately
/// NOT here: it runs through a shell on a UI-collapse event, so letting the RPC
/// (reachable by any local caller) set it would be arbitrary code execution — it
/// is file/env only.
const EDITABLE_CONFIG_KEYS: [&str; 7] = [
    "native_qam",
    "prerelease",
    "owner_settle_secs",
    "interval_secs",
    "force_owner",
    "desktop_ui",
    "native_notifications",
];

/// The ONLY method names proxied to the Python backend — the Deck Shelves plugin's
/// public API. The runner resolves any public attribute by name, so without this
/// the proxy would be a generic gateway to arbitrary Python calls; anything not
/// here answers "unknown method". (Path-safety of the file methods is jailed on
/// the plugin side; this bounds the callable surface to the real API.)
const BACKEND_METHODS: [&str; 35] = [
    "clear_backups",
    "create_backup",
    "create_pre_import_backup",
    "delete_backup",
    "download_release",
    "export_backup",
    "export_settings",
    "get_audio_state",
    "get_bluetooth_state",
    "get_css_loader_themes",
    "get_device_identity",
    "get_display_state",
    "get_hardware_info",
    "get_host_os",
    "get_library_locations",
    "get_perf_snapshot",
    "get_settings",
    "get_shortcut_tags",
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
    "was_settings_recovered",
    "write_json_file",
];

/// Read-only probes and polls — the hub view's status and log refresh, the tray's
/// status line, the runtime's log forwarding. Not logged: they would fill the
/// ring they read.
const QUIET_METHODS: [&str; 10] = [
    "ping",
    "getVersion",
    "getHostApiVersion",
    "isInjected",
    "getBackendStatus",
    "getDiagnostics",
    "getConfig",
    "getRuntimeConfig",
    "getLogs",
    "pushLogs",
];

/// Accepted ranges for the numeric editable keys (seconds). The loop floors the
/// interval at 1 s itself; the caps keep a typo from parking the daemon for hours.
const INTERVAL_SECS_RANGE: std::ops::RangeInclusive<u64> = 1..=3600;
const OWNER_SETTLE_SECS_RANGE: std::ops::RangeInclusive<u64> = 0..=300;

/// Longest request or header line and most headers read from one caller, so a
/// local client cannot grow the daemon's memory by streaming an endless header.
const MAX_HEADER_LINE: u64 = 8 * 1024;
const MAX_HEADERS: usize = 64;

/// Connections handled at once; beyond this the accept loop answers 503 instead
/// of spawning another thread. Each one may sit in a backend call for a while.
const MAX_CONNECTIONS: usize = 64;
static ACTIVE_CONNECTIONS: AtomicUsize = AtomicUsize::new(0);

/// One accepted connection's slot in the bounded pool, released on drop (so a
/// panicking handler or a failed thread spawn never leaks it).
struct ConnectionSlot;

impl ConnectionSlot {
    fn acquire() -> Option<Self> {
        if ACTIVE_CONNECTIONS.fetch_add(1, AtomicOrdering::AcqRel) < MAX_CONNECTIONS {
            return Some(Self);
        }
        ACTIVE_CONNECTIONS.fetch_sub(1, AtomicOrdering::AcqRel);
        None
    }
}

impl Drop for ConnectionSlot {
    fn drop(&mut self) {
        ACTIVE_CONNECTIONS.fetch_sub(1, AtomicOrdering::AcqRel);
    }
}

pub fn serve(addr: &str) {
    let listener = match TcpListener::bind(addr) {
        Ok(l) => {
            log_info("rpc", &format!("Listening on {addr}"));
            // The control endpoint is token-gated, but it is meant for loopback
            // only. Surface a non-loopback bind loudly — someone set rpc_host to a
            // routable address, exposing the endpoint to the local network.
            let loopback = addr.starts_with("127.")
                || addr.starts_with("localhost")
                || addr.starts_with("[::1]");
            if !loopback {
                log_warning(
                    "rpc",
                    &format!(
                        "Control endpoint bound to a NON-loopback address ({addr}) — it is reachable \
                         from the local network. Keep rpc_host at 127.0.0.1 unless you intend this."
                    ),
                );
            }
            // The token file is written only once the port is ours: a second
            // daemon that fails to bind must never replace the running one's token.
            if let Some(p) = crate::config::rpc_token_path() {
                state::persist_rpc_token(&p);
            }
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
            Ok(s) => match ConnectionSlot::acquire() {
                Some(slot) => {
                    let spawned = std::thread::Builder::new().spawn(move || {
                        let _slot = slot;
                        handle_connection(s);
                    });
                    if let Err(e) = spawned {
                        log_warning("rpc", &format!("Could not start a connection thread: {e}"));
                    }
                }
                None => {
                    let mut s = s;
                    let _ = s.set_write_timeout(Some(READ_TIMEOUT));
                    let _ = write_response(
                        &mut s,
                        503,
                        r#"{"ok":false,"error":"too many connections"}"#,
                        None,
                    );
                }
            },
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

    let parsed = serde_json::from_str::<Value>(&request.body).ok();
    let method = parsed
        .as_ref()
        .and_then(|v| v.get("method"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let response_body = dispatch(parsed);
    // Only the method name is logged (capped: it is caller text): a body can be a
    // whole settings document, and the polls would fill the ring they read.
    if !method
        .as_deref()
        .is_some_and(|m| QUIET_METHODS.contains(&m))
    {
        let name: String = method
            .as_deref()
            .unwrap_or("(invalid)")
            .chars()
            .filter(|c| !c.is_control())
            .take(64)
            .collect();
        log_info("rpc", &format!("{peer} -> {name}"));
    }
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

/// One request or header line, refused past `MAX_HEADER_LINE` bytes without a newline.
fn read_line_capped(
    reader: &mut BufReader<&TcpStream>,
    line: &mut String,
) -> std::io::Result<usize> {
    let n = reader.by_ref().take(MAX_HEADER_LINE).read_line(line)?;
    if n as u64 == MAX_HEADER_LINE && !line.ends_with('\n') {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "header line too long",
        ));
    }
    Ok(n)
}

/// Read request line + headers, then exactly `Content-Length` body bytes (capped).
fn read_request(stream: &TcpStream) -> std::io::Result<HttpRequest> {
    let mut reader = BufReader::new(stream);

    let mut request_line = String::new();
    read_line_capped(&mut reader, &mut request_line)?;
    let method = request_line
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string();

    let mut content_length = 0usize;
    let mut origin = None;
    let mut authorization = None;
    let mut content_type = None;
    let mut headers = 0usize;
    loop {
        let mut line = String::new();
        let n = read_line_capped(&mut reader, &mut line)?;
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        headers += 1;
        if headers > MAX_HEADERS {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "too many headers",
            ));
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

/// The release tag a trusted bundle download URL names
/// (`<TRUSTED_BUNDLE_PREFIX><tag>/<file>`), or `None` for any other URL.
fn bundle_tag_from_url(url: &str) -> Option<String> {
    url.strip_prefix(TRUSTED_BUNDLE_PREFIX)?
        .split('/')
        .next()
        .filter(|tag| !tag.is_empty())
        .map(str::to_string)
}

/// Record the installed release as `bundle_tag` after a download, so the
/// "update available" check resolves (else every cycle re-downloads). The tag
/// comes from the fetched URL; the channel's newest tag is the fallback.
fn record_bundle_tag(prerelease: bool, url: &str) {
    let Some(tag) =
        bundle_tag_from_url(url).or_else(|| crate::populate::latest_release_tag(prerelease))
    else {
        return;
    };
    let Some(cfg_path) = crate::state::hub_config_path() else {
        return;
    };
    // The swap kept the old copy as `.prev`; its tag follows it. A download the
    // user asked for also lifts any hold left by a rollback.
    let recorded = tag.clone();
    if let Err(e) = crate::store::update(cfg_path, |s| {
        s.bundle_prev_tag = std::mem::replace(&mut s.bundle_tag, tag);
        s.bundle_hold_tag.clear();
    }) {
        log_warning("rpc", &format!("could not record the bundle tag: {e}"));
    }
    state::set_pending_plugin_update(None);
    state::push_host_notice(
        "notice_plugin_updated",
        serde_json::json!({ "version": recorded }),
    );
}

/// After a bundle rollback: the recorded tags swap places and the undone release
/// is held back from auto-update. Returns the tag now live (empty when unknown).
fn hold_rolled_back_bundle() -> String {
    let Some(cfg_path) = crate::state::hub_config_path() else {
        return String::new();
    };
    let live = crate::store::update(cfg_path, |s| {
        s.bundle_hold_tag = s.bundle_tag.clone();
        std::mem::swap(&mut s.bundle_tag, &mut s.bundle_prev_tag);
    });
    state::set_pending_plugin_update(None);
    match live {
        Ok(s) => s.bundle_tag,
        Err(e) => {
            log_warning("rpc", &format!("could not record the rollback: {e}"));
            String::new()
        }
    }
}

/// Run a manual download, swap or rollback under the loop's single-flight guard,
/// so a user action never moves the same files as a periodic check mid-way.
/// Answers "busy" instead of waiting.
fn under_update_guard(handler: impl FnOnce() -> String) -> String {
    struct Release;
    impl Drop for Release {
        fn drop(&mut self) {
            state::end_update_check();
        }
    }
    if !state::try_begin_update_check() {
        return err("busy: an update check is in flight, try again shortly");
    }
    let _release = Release;
    handler()
}

/// Why a `selfUpdate` for `latest` is skipped: `current` when it is not newer
/// than the running version (a reinstall or a downgrade would snapshot the
/// running set over `previous/`), `staged` when that same release already waits
/// for the restart (the loop skips it the same way). `None` = go ahead.
fn self_update_skip_reason(
    latest: &str,
    current: &str,
    staged: bool,
    pending: Option<&str>,
) -> Option<&'static str> {
    if !version_is_newer(latest, current) {
        Some("current")
    } else if staged && pending == Some(latest) {
        Some("staged")
    } else {
        None
    }
}

/// Exit after the response flushes, so a relaunching service manager brings the
/// daemon back on the binary staged over this one.
fn exit_after_flush(reason: &'static str) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        log_info("rpc", reason);
        std::process::exit(0);
    });
}

/// The update/rollback state the hub screen reads alongside the settings.
fn insert_update_state(obj: &mut serde_json::Map<String, Value>) {
    let plugin_pending = state::pending_plugin_update();
    let rollback_available = state::populate_config()
        .is_some_and(|(path, _)| crate::populate::bundle_rollback_available(path));
    obj.insert(
        "hub_rollback_staged".to_string(),
        Value::Bool(state::hub_rollback_staged()),
    );
    obj.insert(
        "pending_hub_notes".to_string(),
        state::pending_hub_notes().map_or(Value::Null, Value::String),
    );
    obj.insert(
        "pending_plugin_update".to_string(),
        plugin_pending
            .as_ref()
            .map_or(Value::Null, |(tag, _)| Value::String(tag.clone())),
    );
    obj.insert(
        "pending_plugin_notes".to_string(),
        plugin_pending.map_or(Value::Null, |(_, notes)| Value::String(notes)),
    );
    obj.insert(
        "update_deferred".to_string(),
        Value::Bool(state::update_deferred()),
    );
    obj.insert(
        "hub_previous_version".to_string(),
        crate::populate::hub_previous_version().map_or(Value::Null, Value::String),
    );
    obj.insert(
        "bundle_rollback_available".to_string(),
        Value::Bool(rollback_available),
    );
}

/// Route one parsed request body (`None` = not JSON) to its handler.
fn dispatch(parsed: Option<Value>) -> String {
    let method = parsed
        .as_ref()
        .and_then(|v| v.get("method").and_then(Value::as_str).map(str::to_string));

    match method.as_deref() {
        Some("ping") => ok(r#""pong""#.to_string()),
        Some("getVersion") => ok(format!(r#""{}""#, env!("CARGO_PKG_VERSION"))),
        Some("getHostApiVersion") => ok(format!(r#""{}""#, crate::HOST_API_VERSION)),
        Some("isInjected") => ok(state::is_injected().to_string()),
        // Health of the hosted Python backend (loader-local, not proxied).
        // `python_available` surfaces a missing interpreter (e.g. a minimal ARM
        // distro without python3) in diagnostics before the first data call fails.
        Some("getBackendStatus") => ok(format!(
            r#"{{"configured":{},"running":{},"python":{},"python_available":{}}}"#,
            backend::enabled(),
            backend::is_running(),
            serde_json::Value::String(backend::python_bin().to_string()),
            backend::python_available()
        )),
        // Restart ONLY the Python backend (not the daemon): a wedged backend is
        // recovered without bouncing hosting/injection. Returns the fresh status.
        Some("restartBackend") => {
            let running = backend::restart();
            log_info(
                "rpc",
                &format!("Backend restart requested — running={running}."),
            );
            ok(format!(
                r#"{{"configured":{},"running":{},"python":{},"python_available":{}}}"#,
                backend::enabled(),
                running,
                serde_json::Value::String(backend::python_bin().to_string()),
                backend::python_available()
            ))
        }
        // One snapshot for the plugin's "Copy diagnostics" / Support block: host
        // identity + versions + OS/arch + runtime modes + backend/python + update
        // state. Read-only aggregation of what the daemon already knows.
        Some("getDiagnostics") => {
            let rc = state::runtime_config();
            let mode = |k: &str| rc.and_then(|v| v.get(k)).cloned().unwrap_or(Value::Null);
            let diag = serde_json::json!({
                "hostKind": "shelveshub",
                "hubVersion": env!("CARGO_PKG_VERSION"),
                "hostApiVersion": crate::HOST_API_VERSION,
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "hosting": state::is_injected(),
                "backend": {
                    "configured": backend::enabled(),
                    "running": backend::is_running(),
                    "python": backend::python_bin(),
                    "pythonAvailable": backend::python_available(),
                },
                "modes": {
                    "native_qam": mode("native_qam"),
                    "force_owner": mode("force_owner"),
                    "desktop_ui": mode("desktop_ui"),
                    "prerelease": mode("prerelease"),
                },
                "coexistence": {
                    "safeMode": state::daemon_config().map(|c| c.coop_safe_mode).unwrap_or(true),
                    "coopBundle": state::daemon_config().map(|c| c.coop_bundle).unwrap_or(false),
                    "forceReceded": state::coop_receded(),
                },
                "update": {
                    "pending": state::pending_hub_update(),
                    "staged": state::hub_update_staged(),
                    "lastCheckMs": state::millis_since_update_check(),
                },
            });
            ok(diag.to_string())
        }
        // Manual bundle re-download (the fallback panel's "download" action):
        // fetch the newest release into the bundle path; the loop re-injects it.
        Some("populateBundle") => under_update_guard(|| match state::populate_config() {
            Some((path, prerelease)) => {
                match crate::populate::update_from_release(path, *prerelease) {
                    Ok(url) => {
                        record_bundle_tag(*prerelease, &url);
                        log_info("rpc", &format!("Bundle re-downloaded: {url}"));
                        ok(serde_json::Value::String(url).to_string())
                    }
                    Err(e) => err(&e),
                }
            }
            None => err("bundle path not configured"),
        }),
        // Host self-install of a PLUGIN update (`host.updates.applyUpdate`): obtain the
        // given release asset (or the newest) and swap the injected bundle in place; the
        // loop's on-disk watch then hot-swaps the new copy into the renderer.
        Some("applyUpdate") => under_update_guard(|| match state::populate_config() {
            Some((path, prerelease)) => {
                let asset_url = parsed
                    .as_ref()
                    .and_then(|v| v.get("args"))
                    .and_then(|a| a.get("assetUrl"))
                    .and_then(Value::as_str);
                match crate::populate::apply_update(path, asset_url, *prerelease) {
                    Ok(url) => {
                        record_bundle_tag(*prerelease, &url);
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
        }),
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
                        // Millis since the last update check (null = never this
                        // session), so the hub view can show "checked X ago".
                        obj.insert(
                            "last_update_check_ms".to_string(),
                            state::millis_since_update_check().map_or(Value::Null, Value::from),
                        );
                        insert_update_state(obj);
                    }
                    ok(v.to_string())
                }
                Err(e) => err(&format!("serialize config: {e}")),
            },
            None => err("hub config path not configured"),
        },
        // Undo the last Deck Shelves swap: the `.prev` copy becomes live again (the
        // loop's on-disk watch hot-swaps it in) and the undone release is held back
        // from auto-update until a newer one is published.
        Some("rollbackBundle") => under_update_guard(|| match state::populate_config() {
            Some((path, _)) => match crate::populate::rollback_bundle(path) {
                Ok(()) => {
                    let tag = hold_rolled_back_bundle();
                    log_info("rpc", &format!("Rolled Deck Shelves back to {tag:?}."));
                    state::push_host_notice(
                        "notice_plugin_rolled_back",
                        serde_json::json!({ "version": tag }),
                    );
                    ok(format!(
                        r#"{{"rolled_back":true,"tag":{}}}"#,
                        Value::String(tag)
                    ))
                }
                Err(e) => err(&e),
            },
            None => err("bundle path not configured"),
        }),
        // Undo the last hub update: restore the `previous/` snapshot (runtime +
        // assets, and the binary staged like an update) and hold the undone release
        // back from auto-update. Restarts under a relaunching service manager;
        // otherwise the "restart to finish" notice stands.
        Some("rollbackHub") => under_update_guard(|| {
            // With a binary already staged over the running one, the snapshot a
            // rollback takes would capture that staged binary under the running
            // version's label — so the restart that applies it has to come first.
            if state::hub_update_staged() {
                return err(if state::hub_rollback_staged() {
                    "a ShelvesHub rollback is already staged: restart to finish it first"
                } else {
                    "a ShelvesHub update is staged: restart to apply it before rolling back"
                });
            }
            match crate::populate::rollback_hub() {
                Ok(version) => {
                    if let Some(cfg_path) = state::hub_config_path() {
                        let hold = crate::store::update(cfg_path, |s| {
                            s.hub_hold_tag = env!("CARGO_PKG_VERSION").to_string();
                        });
                        if let Err(e) = hold {
                            log_warning("rpc", &format!("could not record the hub hold: {e}"));
                        }
                    }
                    state::set_hub_update_staged(true);
                    state::set_hub_rollback_staged(true);
                    state::set_pending_hub_update(Some(version.clone()));
                    state::set_pending_hub_notes(None);
                    let restarting = crate::populate::under_relaunching_service();
                    log_info(
                        "rpc",
                        &format!("Hub rollback to {version} staged (restarting={restarting})."),
                    );
                    if restarting {
                        // The next start notices the version change and tells the user.
                        exit_after_flush("Restarting to apply hub rollback.");
                    } else {
                        state::push_host_notice(
                            "notice_hub_restored",
                            serde_json::json!({ "version": version }),
                        );
                    }
                    ok(format!(
                        r#"{{"rolled_back":true,"restarting":{restarting},"version":{}}}"#,
                        Value::String(version)
                    ))
                }
                Err(e) => {
                    log_error("rpc", &format!("rollbackHub failed: {e}"));
                    err(&e)
                }
            }
        }),
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
                match crate::store::update(path, |s| s.auto_update = enabled) {
                    Ok(settings) => {
                        log_info("rpc", &format!("Auto-update set to {enabled}."));
                        state::request_sync();
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
                // The six update switches, by the key→field map sync uses too.
                let pref = match key {
                    Some(k)
                        if crate::sync::set_store_value(
                            &mut crate::store::HubSettings::default(),
                            k,
                            value,
                        ) =>
                    {
                        k
                    }
                    other => return err(&format!("unknown update pref key: {other:?}")),
                };
                match crate::store::update(path, |s| {
                    crate::sync::set_store_value(s, pref, value);
                }) {
                    Ok(settings) => {
                        log_info("rpc", &format!("Update pref {pref:?} set to {value}."));
                        state::request_sync();
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
        // Whether the hub's own settings follow the Steam account across devices
        // (see `sync`). Args: a bool, or `{ enabled }`. Turning it on syncs on the
        // next settled tick.
        Some("setConfigSync") => match state::hub_config_path() {
            Some(path) => {
                let enabled = parsed
                    .as_ref()
                    .and_then(|v| v.get("args"))
                    .and_then(|a| {
                        a.as_bool()
                            .or_else(|| a.get("enabled").and_then(Value::as_bool))
                    })
                    .unwrap_or(false);
                match crate::store::update(path, |s| s.config_sync = enabled) {
                    Ok(settings) => {
                        log_info("rpc", &format!("Settings sync set to {enabled}."));
                        if enabled {
                            state::request_sync();
                        }
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
                        let saved = crate::config::update_config_object(path, |obj| {
                            obj.insert("boot_movie".to_string(), Value::Bool(enabled));
                        });
                        if let Err(e) = saved {
                            log_warning(
                                "rpc",
                                &format!("boot_movie not written to the config file: {e}"),
                            );
                        }
                    }
                    log_info("rpc", &format!("Boot movie set to {enabled}."));
                    state::request_sync();
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
                // Edits made here this session apply on the next restart; until
                // then the tab reads them back from the daemon, with the restart
                // note whenever one differs from the value the daemon started with.
                let boot = state::runtime_config();
                let mut restart_pending = false;
                for (key, value) in state::pending_config_edits() {
                    restart_pending |= boot.and_then(|b| b.get(&key)) != Some(&value);
                    obj.insert(key, value);
                }
                // The config file's current values for the synced toggles (edited
                // here or synced from another device) are what the next start
                // applies — the hub screen shows those, with a restart note.
                if let Some(file) =
                    state::config_file_path().map(|p| crate::config::read_config_object(p))
                {
                    for key in crate::sync::CONFIG_KEYS {
                        if let Some(v) = file.get(key) {
                            restart_pending |= crate::sync::needs_restart(key, v);
                            obj.insert(key.to_string(), v.clone());
                        }
                    }
                }
                obj.insert("restart_pending".to_string(), Value::Bool(restart_pending));
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
                "native_qam"
                | "prerelease"
                | "force_owner"
                | "desktop_ui"
                | "native_notifications" => value.as_bool().map(Value::Bool),
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
            let range = match key {
                "interval_secs" => Some(&INTERVAL_SECS_RANGE),
                "owner_settle_secs" => Some(&OWNER_SETTLE_SECS_RANGE),
                _ => None,
            };
            if let Some(range) = range {
                if !coerced.as_u64().is_some_and(|n| range.contains(&n)) {
                    return err(&format!(
                        "{key} out of range: {coerced} (allowed {}-{} seconds)",
                        range.start(),
                        range.end()
                    ));
                }
            }
            let Some(path) = state::config_file_path() else {
                return err("config file path not known");
            };
            // Read-merge-write the config file (create if absent) under the editors'
            // lock, preserving other keys (comments included). Applies on restart.
            let written = crate::config::update_config_object(path, |obj| {
                obj.insert(key.to_string(), coerced.clone());
            });
            match written {
                Ok(()) => {
                    log_info(
                        "rpc",
                        &format!("Config file updated: {key} (restart to apply)."),
                    );
                    state::record_config_edit(key, coerced);
                    if crate::sync::CONFIG_KEYS.contains(&key) {
                        state::request_sync();
                    }
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
            under_update_guard(|| {
                let prerelease = state::hub_config_path()
                    .map(|p| crate::store::load(p).hub_prerelease)
                    .unwrap_or(false);
                // Only a newer release that is not already staged is downloaded (see
                // self_update_skip_reason). A lookup miss falls through to the
                // download's own error.
                let current = env!("CARGO_PKG_VERSION");
                if let Some((latest, _)) = crate::populate::latest_hub_release_info(prerelease) {
                    let pending = state::pending_hub_update();
                    let staged = state::hub_update_staged();
                    if let Some(reason) =
                        self_update_skip_reason(&latest, current, staged, pending.as_deref())
                    {
                        let line =
                            format!("Hub self-update skipped ({reason}): {latest} vs {current}.");
                        log_info("rpc", &line);
                        return ok(format!(r#"{{"updated":false,"reason":"{reason}"}}"#));
                    }
                }
                match crate::populate::apply_hub_update(prerelease) {
                    Ok(tag) => {
                        // An update the user asked for lifts the hold a rollback left.
                        if let Some(cfg_path) = state::hub_config_path() {
                            let lifted = crate::store::update(cfg_path, |s| s.hub_hold_tag.clear());
                            if let Err(e) = lifted {
                                log_warning("rpc", &format!("could not lift the hub hold: {e}"));
                            }
                        }
                        state::set_hub_update_staged(true);
                        state::set_hub_rollback_staged(false);
                        state::set_pending_hub_update(Some(tag.clone()));
                        let restarting = crate::populate::under_relaunching_service();
                        log_info(
                            "rpc",
                            &format!("Hub self-update {tag} staged (restarting={restarting})."),
                        );
                        if restarting {
                            // The renderer keeps the current runtime until the new
                            // daemon re-injects; the next start tells the user.
                            exit_after_flush("Restarting to apply hub update.");
                        } else {
                            state::push_host_notice(
                                "notice_hub_staged",
                                serde_json::json!({ "version": tag }),
                            );
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
            })
        }
        // Manual "Check now": run one update check immediately (same path as the
        // periodic loop, single-flight) and report the refreshed status so the hub
        // view updates without waiting for the next 30-minute cycle.
        Some("checkUpdates") => {
            let ran = crate::loader::run_update_check_now();
            let pending = state::pending_hub_update().map_or(Value::Null, Value::String);
            let last_ms = state::millis_since_update_check().map_or(Value::Null, Value::from);
            ok(format!(
                r#"{{"ran":{},"pending_hub_update":{},"hub_update_staged":{},"last_update_check_ms":{},"update_deferred":{}}}"#,
                ran,
                pending,
                state::hub_update_staged(),
                last_ms,
                state::update_deferred()
            ))
        }
        // Restart the daemon so pending config-file edits (interval, native_qam,
        // owner_settle, force_owner, …) take effect — they are only read at startup.
        // Under a relaunching service manager the daemon exits (after the response
        // flushes) and the manager relaunches a fresh process that re-reads the
        // config; otherwise the "restart to apply" notice stands. The renderer
        // restart (for owner claiming on a fresh boot) is the caller's job.
        Some("restartService") => {
            let managed = crate::populate::under_relaunching_service();
            log_info(
                "rpc",
                &format!("Service restart requested (relaunching manager={managed})."),
            );
            // Always restart: under a relaunching manager (launchd KeepAlive /
            // systemd Restart=always / Windows task) just exit and let it bring us
            // back; otherwise relaunch ourselves so the request is never a no-op.
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                if !managed {
                    crate::populate::relaunch_self();
                }
                log_info("rpc", "Restarting now.");
                std::process::exit(0);
            });
            ok(r#"{"restarting":true}"#.to_string())
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
    format!(
        r#"{{"ok":false,"error":{}}}"#,
        Value::String(message.to_string())
    )
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
        503 => "Service Unavailable",
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
#[path = "tests/rpc_tests.rs"]
mod tests;
