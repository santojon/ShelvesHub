// A console program on Windows too: `status` / `doctor` print to the console it
// was started from, and the logon task hides the daemon's own one (register-task.ps1).

use std::io::Write;
use std::net::TcpListener;
use std::path::PathBuf;

use shelveshub::config::{backend_install_dir, Config};
use shelveshub::logger::{log_error, log_info, log_warning};
use shelveshub::{backend, bootmovie, loader, populate, rpc, state};

fn main() {
    // `shelveshub status [--report]`: emit a one-shot diagnostics report and exit,
    // without starting the daemon (the terminal-side tester report — see report.rs).
    if std::env::args().nth(1).as_deref() == Some("status") {
        shelveshub::report::print_status_report();
        return;
    }
    // `shelveshub doctor [--fix]`: check the setup (CEF flag, debug port, Steam,
    // service) and, with --fix, apply the one safe fix (create the CEF flag).
    if std::env::args().nth(1).as_deref() == Some("doctor") {
        let fix = std::env::args().any(|a| a == "--fix");
        shelveshub::report::print_doctor(fix);
        return;
    }

    if let Some(arg) = std::env::args().nth(1) {
        eprintln!("shelveshub: unknown argument {arg:?}. Usage: shelveshub [status [--report] | doctor [--fix]]");
        std::process::exit(2);
    }

    log_info("main", "ShelvesHub starting...");
    log_info("main", concat!("Version: ", env!("CARGO_PKG_VERSION")));

    let config = Config::from_env();
    // The control endpoint first: a daemon that cannot own it exits here, before it
    // touches the install, the store, Steam's files or the renderer.
    let listener = bind_control_endpoint(&config.rpc_addr);

    // A prior self-update stages the binary swap and takes effect on this start;
    // clear any leftover swap artifacts (an interrupted `.new`, the moved-aside
    // `.old` on Windows) now that the new binary is the one running.
    populate::cleanup_stale_update_artifacts();

    // The plugin channel is read live at every update check (`plugin_prerelease`);
    // this boot value only serves the first obtains and the RPC handlers' snapshot.
    // A working bundle is never overwritten on boot, whatever the channel.
    let hub_prefs = shelveshub::store::load(&config.hub_config_path);
    let prerelease =
        populate::plugin_prerelease(config.prerelease, &config.settings_dir, &hub_prefs);
    if prerelease != config.prerelease {
        log_info(
            "main",
            "Pre-release downloads on for the first obtain (plugin beta channel or hub plugin beta).",
        );
    }

    // A different binary since the last run (an update, or a rollback) → the user is
    // told once the renderer is there; the running version is remembered.
    shelveshub::loader::note_version_change(&config.hub_config_path);

    // The Deck Shelves Python backend for a SOLE host (no loader: macOS/Windows),
    // so the data RPCs work, not just local shelves. Obtained when nothing is
    // configured, after the control endpoint is up and before the first inject.
    let backend_obtain = config
        .backend_dir
        .is_none()
        .then(backend_install_dir)
        .flatten();

    log_info("main", &format!("Config: {}", config.summary()));
    state::set_hub_config_path(config.hub_config_path.clone());

    // Optional: install (or remove) the startup animation in Steam's own
    // startup-movie slot. Best-effort — a failure here never blocks the daemon.
    // The source + current state are also published so the `setBootMovie` RPC can
    // toggle it live (install/remove on the spot) without a restart.
    state::set_boot_movie_source(config.boot_movie_path.clone());
    state::set_boot_movie_enabled(config.boot_movie);
    match bootmovie::apply(config.boot_movie, &config.boot_movie_path) {
        Ok(Some(p)) => log_info("main", &format!("boot movie installed: {}", p.display())),
        Ok(None) => {}
        Err(e) => log_warning("main", &format!("boot movie skipped: {e}")),
    }

    // Host the Deck Shelves Python backend (data RPC) when configured; a pending
    // obtain starts hosting itself once the backend lands.
    if backend_obtain.is_none() {
        backend::init(&config);
    }

    // Expose the bundle path + pre-release flag to RPC handlers (the fallback
    // panel's manual re-download) before the server starts.
    state::set_populate_config(config.bundle_path.clone(), prerelease);
    // Effective operational config, for the hub's "advanced configuration" mirror
    // (read-only display + an editable safe subset that writes the config file and
    // applies on the next restart). Built before `config` is moved into the loop.
    state::set_runtime_config(
        shelveshub::config::config_file_path(),
        serde_json::json!({
            "cef_host": config.cef_host,
            "cef_port": config.cef_port,
            "rpc_addr": config.rpc_addr,
            "interval_secs": config.interval_secs,
            "owner_settle_secs": config.owner_settle_secs,
            "native_qam": config.native_qam,
            "desktop_ui": config.desktop_ui,
            "native_notifications": config.native_notifications,
            "boot_movie": config.boot_movie,
            "prerelease": prerelease,
            "force_owner": config.force_owner,
            "coop_bundle": config.coop_bundle,
            "recover_cmd": config.recover_cmd,
            "bundle_path": config.bundle_path.display().to_string(),
            // Boot value only: `getRuntimeConfig` answers `backend::enabled()`, which
            // turns true once a first-boot obtain starts hosting.
            "backend": config.backend_dir.is_some(),
            "version": env!("CARGO_PKG_VERSION"),
            // Whether another plugin loader can coexist here — only on
            // Linux/SteamOS. On macOS/Windows this is a pure sole host, so the
            // coexist-only settings (force_owner, coop_bundle, owner_settle_secs)
            // are inert and the UI hides them.
            "loader_possible": cfg!(target_os = "linux"),
        }),
    );

    // Serve the bound endpoint on a background thread so the loader loop runs
    // beside it; a client that connected since the bind waits in the backlog.
    std::thread::spawn(move || rpc::serve(listener));

    if let Some(dir) = backend_obtain {
        obtain_backend(config.clone(), dir, prerelease);
    }

    loader::run(config);
}

/// Bind the control endpoint or exit: without it nothing can be saved. A port in
/// use usually means a ShelvesHub already running (whose token file stays as it
/// is); any other error is named as itself.
fn bind_control_endpoint(addr: &str) -> TcpListener {
    match rpc::bind(addr) {
        Ok(listener) => listener,
        Err(e) => {
            let hint = match e.kind() {
                std::io::ErrorKind::AddrInUse => {
                    "Another ShelvesHub is probably running (or another process holds the port), \
                     so this one exits. Stop the other process, or set `rpc_port` in \
                     shelveshub.config.json to a free port, then start the service again."
                }
                std::io::ErrorKind::AddrNotAvailable => {
                    "Check `rpc_host` / `rpc_port` in shelveshub.config.json (the address must \
                     belong to this machine), then start the service again."
                }
                _ => {
                    "Check `rpc_host` / `rpc_port` in shelveshub.config.json (an address of this \
                     machine and a port this user may open), then start the service again."
                }
            };
            log_error(
                "main",
                &format!("Failed to bind the control endpoint {addr}: {e}. {hint}"),
            );
            let _ = std::io::stdout().flush();
            std::process::exit(1);
        }
    }
}

/// First-boot obtain of the hub-managed backend (local, loader copy or download),
/// then hosting starts on it. Runs after the RPC server is up, before the injection
/// loop; best-effort — on a miss the daemon runs core-only, no crash.
fn obtain_backend(mut config: Config, dir: PathBuf, prerelease: bool) {
    match populate::ensure_backend(&dir, prerelease) {
        Ok(src) => {
            log_info("backend", &format!("Backend ready via {src}."));
            if dir.join("main.py").is_file() {
                config.backend_dir = Some(dir);
                backend::init(&config);
            }
        }
        Err(e) => log_warning(
            "backend",
            &format!(
                "No backend obtained ({e}); data RPC stays disabled (local shelves still work)."
            ),
        ),
    }
}
