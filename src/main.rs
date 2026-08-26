use shelveshub::config::Config;
use shelveshub::logger::log_info;
use shelveshub::{backend, loader, rpc, state};

fn main() {
    log_info("main", "ShelvesHub starting...");
    log_info("main", concat!("Version: ", env!("CARGO_PKG_VERSION")));

    let config = Config::from_env();
    log_info("main", &format!("Config: {}", config.summary()));

    // Host the Deck Shelves Python backend (data RPC) when configured.
    backend::init(&config);

    // Expose the bundle path + pre-release flag to RPC handlers (the fallback
    // panel's manual re-download) before the server starts.
    state::set_populate_config(config.bundle_path.clone(), config.prerelease);
    state::set_hub_config_path(config.hub_config_path.clone());

    // Spawn the RPC server on a background thread so the loader loop
    // can run concurrently without blocking on incoming connections.
    let rpc_addr = config.rpc_addr.clone();
    std::thread::spawn(move || rpc::serve(&rpc_addr));

    loader::run(config);
}
