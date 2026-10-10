//! `shelveshub-tray` — the optional cross-OS tray companion (built only with the
//! `tray` feature). A thin front-end over the daemon's local RPC: a menu-bar /
//! system-tray icon that shows whether ShelvesHub is hosting and offers quick
//! actions (pause/resume, restart the service, restart the data backend). It owns
//! no state — every action is an RPC call to the running daemon, authenticated
//! with the per-boot token the daemon writes to a 0600 file for same-user tools.
//!
//! The tray backend is per-OS: macOS + Windows use `tray-icon` (+ a `tao` event
//! loop); Linux uses `ksni` (a pure-Rust StatusNotifierItem over DBus, hosted
//! natively by KDE/SteamOS — no gtk/appindicator/xdo).

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use serde_json::Value;

const REFRESH: Duration = Duration::from_secs(5);

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

/// Decode the embedded monochrome glyph (black + alpha, 8-bit RGBA). Shared by both
/// backends; each tints/converts it as its platform needs.
fn template_rgba() -> Option<(Vec<u8>, u32, u32)> {
    const PNG: &[u8] = include_bytes!("../../assets/icons/tray-template.png");
    let mut reader = png::Decoder::new(PNG).read_info().ok()?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).ok()?;
    buf.truncate(info.buffer_size());
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return None;
    }
    Some((buf, info.width, info.height))
}

// ── macOS + Windows backend (tray-icon + tao) ────────────────────────────────
#[cfg(not(target_os = "linux"))]
mod desktop {
    use super::{rpc, status_line, template_rgba, Value, REFRESH};
    use std::time::Instant;
    use tao::event_loop::{ControlFlow, EventLoopBuilder};
    use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
    use tray_icon::{Icon, TrayIconBuilder};

    const THEME_CHECK: std::time::Duration = std::time::Duration::from_secs(30);

    /// The glyph as a tray-icon image. macOS keeps it black and marks it a template
    /// (auto light/dark); Windows tints it to contrast the taskbar.
    fn tray_icon(dark_bar: bool) -> Option<Icon> {
        let (buf, w, h) = template_rgba()?;
        #[cfg(target_os = "macos")]
        let _ = dark_bar; // the template image handles tinting on macOS
        #[cfg(not(target_os = "macos"))]
        let buf = {
            // Not macOS: tint the glyph to contrast the taskbar (no auto-template).
            let mut b = buf;
            let tone: u8 = if dark_bar { 235 } else { 40 };
            for px in b.chunks_exact_mut(4) {
                px[0] = tone;
                px[1] = tone;
                px[2] = tone;
            }
            b
        };
        Icon::from_rgba(buf, w, h).ok()
    }

    /// Whether the taskbar is dark (so the glyph should be light). Windows reads the
    /// Personalize flag; macOS never calls this (the template adapts). None = macOS.
    fn detect_theme() -> Option<bool> {
        #[cfg(target_os = "macos")]
        {
            None
        }
        #[cfg(target_os = "windows")]
        {
            let out = std::process::Command::new("reg")
                .args([
                    "query",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                    "/v",
                    "SystemUsesLightTheme",
                ])
                .output()
                .ok();
            // 0x0 = dark taskbar; default to dark (light glyph) when unknown.
            Some(match out {
                Some(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).contains("0x0"),
                _ => true,
            })
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Some(true)
        }
    }

    pub fn run() {
        #[allow(unused_mut)]
        let mut event_loop = EventLoopBuilder::new().build();
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
        let (sep, sep2) = (
            PredefinedMenuItem::separator(),
            PredefinedMenuItem::separator(),
        );
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

        let (id_pause, id_resume) = (pause.id().clone(), resume.id().clone());
        let (id_svc, id_backend, id_quit) = (
            restart_svc.id().clone(),
            restart_backend.id().clone(),
            quit.id().clone(),
        );

        let mut tray = None;
        let menu_rx = MenuEvent::receiver();
        let mut next_refresh = Instant::now();
        let mut theme = detect_theme();
        let mut next_theme = Instant::now() + THEME_CHECK;

        event_loop.run(move |_event, _target, control_flow| {
            if tray.is_none() {
                let mut b = TrayIconBuilder::new()
                    .with_menu(Box::new(menu.clone()))
                    .with_tooltip("ShelvesHub");
                if let Some(icon) = tray_icon(theme.unwrap_or(true)) {
                    b = b.with_icon(icon);
                }
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
            if Instant::now() >= next_theme {
                next_theme = Instant::now() + THEME_CHECK;
                let now = detect_theme();
                if now != theme {
                    theme = now;
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
}

// ── Linux backend (ksni / StatusNotifierItem) ────────────────────────────────
#[cfg(target_os = "linux")]
mod linux {
    use super::{rpc, status_line, template_rgba, REFRESH};

    /// The glyph as a ksni pixmap (ARGB32). Tinted light — KDE/SteamOS panels are
    /// dark by default — keeping the template's alpha shape.
    fn icon_pixmap() -> Vec<ksni::Icon> {
        let Some((rgba, w, h)) = template_rgba() else {
            return Vec::new();
        };
        let mut argb = Vec::with_capacity(rgba.len());
        for px in rgba.chunks_exact(4) {
            argb.extend_from_slice(&[px[3], 235, 235, 235]); // A, R, G, B (light)
        }
        vec![ksni::Icon {
            width: w as i32,
            height: h as i32,
            data: argb,
        }]
    }

    struct ShelvesTray {
        status: String,
    }

    impl ksni::Tray for ShelvesTray {
        fn id(&self) -> String {
            "shelveshub-tray".into()
        }
        fn title(&self) -> String {
            "ShelvesHub".into()
        }
        fn icon_pixmap(&self) -> Vec<ksni::Icon> {
            icon_pixmap()
        }
        fn tool_tip(&self) -> ksni::ToolTip {
            ksni::ToolTip {
                title: "ShelvesHub".into(),
                description: self.status.clone(),
                icon_name: String::new(),
                icon_pixmap: Vec::new(),
            }
        }
        fn menu(&self) -> Vec<ksni::menu::MenuItem<Self>> {
            use ksni::menu::{MenuItem, StandardItem};
            vec![
                StandardItem {
                    label: "ShelvesHub".into(),
                    enabled: false,
                    ..Default::default()
                }
                .into(),
                StandardItem {
                    label: self.status.clone(),
                    enabled: false,
                    ..Default::default()
                }
                .into(),
                MenuItem::Separator,
                StandardItem {
                    label: "Pause hosting".into(),
                    activate: Box::new(|_: &mut Self| {
                        let _ = rpc("setHostingPaused", Some(true.into()));
                    }),
                    ..Default::default()
                }
                .into(),
                StandardItem {
                    label: "Resume hosting".into(),
                    activate: Box::new(|_: &mut Self| {
                        let _ = rpc("setHostingPaused", Some(false.into()));
                    }),
                    ..Default::default()
                }
                .into(),
                StandardItem {
                    label: "Restart service".into(),
                    activate: Box::new(|_: &mut Self| {
                        let _ = rpc("restartService", None);
                    }),
                    ..Default::default()
                }
                .into(),
                StandardItem {
                    label: "Restart data backend".into(),
                    activate: Box::new(|_: &mut Self| {
                        let _ = rpc("restartBackend", None);
                    }),
                    ..Default::default()
                }
                .into(),
                MenuItem::Separator,
                StandardItem {
                    label: "Quit tray".into(),
                    activate: Box::new(|_: &mut Self| std::process::exit(0)),
                    ..Default::default()
                }
                .into(),
            ]
        }
    }

    pub fn run() {
        use ksni::blocking::TrayMethods;
        // Register with the StatusNotifierWatcher — retry, since the panel (KDE in
        // SteamOS Desktop Mode) may not be up yet at login, and there is no tray to
        // host us in Gaming Mode at all. Give up on nothing; just wait for a panel.
        let handle = loop {
            match (ShelvesTray {
                status: status_line(),
            })
            .spawn()
            {
                Ok(h) => break h,
                Err(e) => {
                    eprintln!("shelveshub-tray: no system tray yet ({e}); retrying in 10s");
                    std::thread::sleep(std::time::Duration::from_secs(10));
                }
            }
        };
        loop {
            std::thread::sleep(REFRESH);
            let s = status_line();
            handle.update(move |t: &mut ShelvesTray| {
                t.status = s;
            });
        }
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    linux::run();
    #[cfg(not(target_os = "linux"))]
    desktop::run();
}
