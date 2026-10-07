//! `shelveshub-tray` — the optional cross-OS tray companion (built only with the
//! `tray` feature). It is a thin front-end over the daemon's local RPC: a menu-bar
//! / system-tray icon that shows whether ShelvesHub is hosting and offers quick
//! actions (pause/resume, restart the service, restart the data backend). It owns
//! no state — every action is an RPC call to the running daemon, authenticated
//! with the per-boot token the daemon writes to a 0600 file for same-user tools.

use std::io::{Read, Write};
use std::net::TcpStream;
#[cfg(not(target_os = "macos"))]
use std::process::Command;
use std::time::{Duration, Instant};

use serde_json::Value;
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, TrayIconBuilder};

const REFRESH: Duration = Duration::from_secs(5);
/// How often to re-check the OS light/dark theme (to re-tint the icon off macOS).
const THEME_CHECK: Duration = Duration::from_secs(30);

fn rpc_addr() -> String {
    std::env::var("SHELVES_RPC_ADDR").unwrap_or_else(|_| "127.0.0.1:60123".to_string())
}

fn token() -> Option<String> {
    let path = shelveshub::config::rpc_token_path()?;
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// One blocking JSON-RPC call to the daemon over loopback HTTP. Returns the parsed
/// response object, or None when the daemon is unreachable / unauthenticated.
fn rpc(method: &str, args: Option<Value>) -> Option<Value> {
    let tok = token()?;
    let body = match args {
        Some(a) => serde_json::json!({ "method": method, "args": a }),
        None => serde_json::json!({ "method": method }),
    }
    .to_string();
    let addr = rpc_addr();
    let mut stream = TcpStream::connect(&addr).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(4))).ok()?;
    let req = format!(
        "POST / HTTP/1.1\r\nHost: {addr}\r\nAuthorization: Bearer {tok}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(req.as_bytes()).ok()?;
    let mut raw = String::new();
    stream.read_to_string(&mut raw).ok()?;
    let payload = raw.split("\r\n\r\n").nth(1)?;
    serde_json::from_str::<Value>(payload).ok()
}

/// A short status line for the menu + tooltip, derived from getDiagnostics.
/// `hosting` is the truth that the bundle is injected and running — the sole host
/// does not always set `bundleReady`, so it must not gate the "active" label.
fn status_line() -> String {
    match rpc("getDiagnostics", None) {
        Some(v) => {
            let r = v.get("result").unwrap_or(&v);
            if r.get("hosting").and_then(Value::as_bool).unwrap_or(false) {
                "Hosting — Deck Shelves active".into()
            } else {
                "Running — not hosting (coexist/idle)".into()
            }
        }
        None => "Daemon not reachable".into(),
    }
}

/// The ShelvesHub mark as a monochrome menu-bar glyph (black + alpha), embedded so
/// the companion stays a single self-contained binary. On macOS it is marked as a
/// template image (see the builder) so the system tints it light/dark with the bar.
/// Other platforms don't auto-invert, so the glyph is tinted to contrast the bar:
/// light on a dark bar, dark on a light bar (`dark_bar` from `bar_is_dark()`).
fn tray_icon(dark_bar: bool) -> Option<Icon> {
    const PNG: &[u8] = include_bytes!("../../assets/icons/tray-template.png");
    let mut reader = png::Decoder::new(PNG).read_info().ok()?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).ok()?;
    buf.truncate(info.buffer_size());
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return None;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let tone: u8 = if dark_bar { 235 } else { 40 };
        for px in buf.chunks_exact_mut(4) {
            px[0] = tone;
            px[1] = tone;
            px[2] = tone;
        }
    }
    #[cfg(target_os = "macos")]
    let _ = dark_bar; // unused on macOS (the template handles tinting)
    Icon::from_rgba(buf, info.width, info.height).ok()
}

/// Run a command and return trimmed stdout (best-effort) — for theme detection.
#[cfg(not(target_os = "macos"))]
fn cmd_capture(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Whether the taskbar/panel is dark (so the glyph should be light). Best-effort:
/// Windows reads the Personalize `SystemUsesLightTheme` flag; Linux asks GNOME's
/// `color-scheme`. Unknown → assume a dark bar (the common default) so the light
/// glyph stays visible. macOS never calls this (the template adapts itself).
#[cfg(not(target_os = "macos"))]
fn bar_is_dark() -> bool {
    #[cfg(target_os = "windows")]
    {
        // SystemUsesLightTheme: 0x1 = light taskbar, 0x0 = dark taskbar.
        if let Some(out) = cmd_capture(
            "reg",
            &[
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                "/v",
                "SystemUsesLightTheme",
            ],
        ) {
            return out.contains("0x0");
        }
        true
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(out) = cmd_capture(
            "gsettings",
            &["get", "org.gnome.desktop.interface", "color-scheme"],
        ) {
            let o = out.to_ascii_lowercase();
            if o.contains("dark") {
                return true;
            }
            if o.contains("light") {
                return false;
            }
        }
        true
    }
}

/// The current theme as the tray tracks it: `Some(dark_bar)` on platforms that
/// detect it, `None` on macOS (the template image self-adapts).
fn detect_theme() -> Option<bool> {
    #[cfg(target_os = "macos")]
    {
        None
    }
    #[cfg(not(target_os = "macos"))]
    {
        Some(bar_is_dark())
    }
}

fn main() {
    #[allow(unused_mut)]
    let mut event_loop = EventLoopBuilder::new().build();
    // Menu-bar-only agent: no Dock icon / app-switcher entry on macOS.
    #[cfg(target_os = "macos")]
    {
        use tao::platform::macos::{ActivationPolicy, EventLoopExtMacOS};
        event_loop.set_activation_policy(ActivationPolicy::Accessory);
    }

    let menu = Menu::new();
    let header = MenuItem::new("ShelvesHub", false, None);
    let status = MenuItem::new(status_line(), false, None);
    let pause = MenuItem::new("Pause hosting", true, None);
    let resume = MenuItem::new("Resume hosting", true, None);
    let restart_svc = MenuItem::new("Restart service", true, None);
    let restart_backend = MenuItem::new("Restart data backend", true, None);
    let quit = MenuItem::new("Quit tray", true, None);
    let sep = PredefinedMenuItem::separator();
    let sep2 = PredefinedMenuItem::separator();
    let _ = menu.append_items(&[
        &header,
        &status,
        &sep,
        &pause,
        &resume,
        &restart_svc,
        &restart_backend,
        &sep2,
        &quit,
    ]);

    // Keep the ids to match click events to actions.
    let (id_pause, id_resume) = (pause.id().clone(), resume.id().clone());
    let (id_svc, id_backend, id_quit) = (
        restart_svc.id().clone(),
        restart_backend.id().clone(),
        quit.id().clone(),
    );

    // The tray must be built on the main thread; keep it alive for the loop.
    let mut tray = None;
    let menu_rx = MenuEvent::receiver();
    let mut next_refresh = Instant::now();
    // Tracked OS theme (None on macOS: the template image self-adapts). Off macOS,
    // re-tint the icon when the taskbar/panel flips light/dark.
    let mut theme = detect_theme();
    let mut next_theme = Instant::now() + THEME_CHECK;

    event_loop.run(move |_event, _target, control_flow| {
        // Create the tray once the loop is running (required on macOS).
        if tray.is_none() {
            let mut b = TrayIconBuilder::new()
                .with_menu(Box::new(menu.clone()))
                .with_tooltip("ShelvesHub");
            if let Some(icon) = tray_icon(theme.unwrap_or(true)) {
                b = b.with_icon(icon);
            }
            // macOS tints a template image to match the menu bar (light/dark).
            #[cfg(target_os = "macos")]
            {
                b = b.with_icon_as_template(true);
            }
            tray = b.build().ok();
        }

        if Instant::now() >= next_refresh {
            status.set_text(status_line());
            next_refresh = Instant::now() + REFRESH;
        }

        // Re-tint the icon when the OS theme flips (off macOS; a no-op on macOS,
        // where detect_theme() is None and the template image adapts itself).
        if Instant::now() >= next_theme {
            next_theme = Instant::now() + THEME_CHECK;
            let now_theme = detect_theme();
            if now_theme != theme {
                theme = now_theme;
                if let Some(t) = tray.as_ref() {
                    let _ = t.set_icon(tray_icon(theme.unwrap_or(true)));
                }
            }
        }

        if let Ok(ev) = menu_rx.try_recv() {
            if ev.id == id_quit {
                *control_flow = ControlFlow::Exit;
                return;
            } else if ev.id == id_pause {
                let _ = rpc("setHostingPaused", Some(Value::Bool(true)));
            } else if ev.id == id_resume {
                let _ = rpc("setHostingPaused", Some(Value::Bool(false)));
            } else if ev.id == id_svc {
                let _ = rpc("restartService", None);
            } else if ev.id == id_backend {
                let _ = rpc("restartBackend", None);
            }
            status.set_text(status_line());
        }

        *control_flow = ControlFlow::WaitUntil(next_refresh.min(next_theme));
    });
}
