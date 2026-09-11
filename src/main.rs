use shelveshub::config::{backend_install_dir, Config};
use shelveshub::logger::{log_info, log_warning};
use shelveshub::{backend, loader, populate, rpc, state};

fn main() {
    log_info("main", "ShelvesHub starting...");
    log_info("main", concat!("Version: ", env!("CARGO_PKG_VERSION")));

    // A prior self-update stages the binary swap and takes effect on this start;
    // clear any leftover swap artifacts (an interrupted `.new`, the moved-aside
    // `.old` on Windows) now that the new binary is the one running.
    populate::cleanup_stale_update_artifacts();

    let mut config = Config::from_env();

    // Beta channel for the bundle + backend obtains combines three sources, so
    // the hub honours the plugin's own toggles AND its own criteria:
    //   * an explicit env pre-release flag (`config.prerelease`) always forces it;
    //   * the PLUGIN's own beta channel (`betaChannelEnabled`) — honoured as-is;
    //   * the hub's own plugin beta switch, but only while the master auto-update
    //     and the per-plugin switch are both on (the toggle hierarchy).
    // A working bundle is still never overwritten on boot regardless of channel.
    let prefs = populate::plugin_update_prefs(&config.settings_dir);
    let hub_prefs = shelveshub::store::load(&config.hub_config_path);
    let hub_plugin_beta =
        hub_prefs.auto_update && hub_prefs.auto_update_plugin && hub_prefs.plugin_prerelease;
    let effective_prerelease = config.prerelease || prefs.beta || hub_plugin_beta;
    if effective_prerelease != config.prerelease {
        log_info(
            "main",
            &format!(
                "Pre-release downloads on (plugin beta channel={}, hub plugin beta={}, plugin auto-update={}).",
                prefs.beta, hub_plugin_beta, prefs.auto_update
            ),
        );
    }
    config.prerelease = effective_prerelease;

    // Obtain the Deck Shelves Python backend for a SOLE host (no plugin loader —
    // e.g. macOS/Windows) so the data RPCs work (settings persistence, online
    // wishlist/prices, launchers, device state), not just local shelves. Skipped
    // when the backend is already configured (explicit dir, or a loader-hosted
    // backend). Best-effort: on a miss the daemon runs core-only, no crash.
    if config.backend_dir.is_none() {
        if let Some(dir) = backend_install_dir() {
            match populate::ensure_backend(&dir, config.prerelease) {
                Ok(src) => {
                    log_info("backend", &format!("Backend ready via {src}."));
                    if dir.join("main.py").is_file() {
                        config.backend_dir = Some(dir);
                    }
                }
                Err(e) => log_warning(
                    "backend",
                    &format!("No backend obtained ({e}); data RPC stays disabled (local shelves still work)."),
                ),
            }
        }
    }

    log_info("main", &format!("Config: {}", config.summary()));

    // Host the Deck Shelves Python backend (data RPC) when configured.
    backend::init(&config);

    // Expose the bundle path + pre-release flag to RPC handlers (the fallback
    // panel's manual re-download) before the server starts.
    state::set_populate_config(config.bundle_path.clone(), config.prerelease);
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
            "prerelease": config.prerelease,
            "force_owner": config.force_owner,
            "recover_cmd": config.recover_cmd,
            "bundle_path": config.bundle_path.display().to_string(),
            "backend": config.backend_dir.is_some(),
            "version": env!("CARGO_PKG_VERSION"),
            // Whether another plugin loader (the loader) can coexist here — only on
            // Linux/SteamOS. On macOS/Windows this is a pure sole host, so the
            // coexist-only settings (force_owner, owner_settle_secs) are inert and
            // the UI hides them.
            "loader_possible": cfg!(target_os = "linux"),
        }),
    );

    // Spawn the RPC server on a background thread so the loader loop
    // can run concurrently without blocking on incoming connections.
    let rpc_addr = config.rpc_addr.clone();
    std::thread::spawn(move || rpc::serve(&rpc_addr));

    loader::run(config);
}
