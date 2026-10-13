use std::path::PathBuf;

use shelveshub::config::{backend_install_dir, Config};
use shelveshub::logger::{log_info, log_warning};
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

    // A prior self-update stages the binary swap and takes effect on this start;
    // clear any leftover swap artifacts (an interrupted `.new`, the moved-aside
    // `.old` on Windows) now that the new binary is the one running.
    populate::cleanup_stale_update_artifacts();

    let config = Config::from_env();

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
    // configured, off the start path: a slow network delays only the data RPCs.
    let backend_obtain = config
        .backend_dir
        .is_none()
        .then(backend_install_dir)
        .flatten();

    log_info("main", &format!("Config: {}", config.summary()));

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
    state::set_hub_config_path(config.hub_config_path.clone());
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
            "recover_cmd": config.recover_cmd,
            "bundle_path": config.bundle_path.display().to_string(),
            // Backend hosting is on: configured, or being obtained for this sole
            // host (it starts when it lands; `getBackendStatus` is the live state).
            "backend": config.backend_dir.is_some() || backend_obtain.is_some(),
            "version": env!("CARGO_PKG_VERSION"),
            // Whether another plugin loader can coexist here — only on
            // Linux/SteamOS. On macOS/Windows this is a pure sole host, so the
            // coexist-only settings (force_owner, owner_settle_secs) are inert and
            // the UI hides them.
            "loader_possible": cfg!(target_os = "linux"),
        }),
    );

    // Spawn the RPC server on a background thread so the loader loop can run
    // concurrently without blocking on incoming connections. It publishes the
    // per-boot token file once its port is bound (see `rpc::serve`).
    let rpc_addr = config.rpc_addr.clone();
    std::thread::spawn(move || rpc::serve(&rpc_addr));

    if let Some(dir) = backend_obtain {
        let hosted = config.clone();
        std::thread::spawn(move || obtain_backend(hosted, dir, prerelease));
    }

    loader::run(config);
}

/// First-boot obtain of the hub-managed backend (local, loader copy or download),
/// then hosting starts on it. Runs beside the RPC server and the injection loop;
/// best-effort — on a miss the daemon runs core-only, no crash.
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
