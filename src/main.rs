use shelves_loader::config::Config;
use shelves_loader::logger::log_info;
use shelves_loader::{loader, rpc};

fn main() {
    log_info("main", "Shelves Loader starting...");
    log_info("main", concat!("Version: ", env!("CARGO_PKG_VERSION")));

    let config = Config::from_env();
    log_info("main", &format!("Config: {}", config.summary()));

    // Spawn the RPC server on a background thread so the loader loop
    // can run concurrently without blocking on incoming connections.
    let rpc_addr = config.rpc_addr.clone();
    std::thread::spawn(move || rpc::serve(&rpc_addr));

    loader::run(config);
}
