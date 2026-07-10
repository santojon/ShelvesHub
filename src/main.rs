use shelveshub::config::Config;
use shelveshub::logger::log_info;
use shelveshub::{loader, rpc};

fn main() {
    log_info("main", "ShelvesHub starting...");
    log_info("main", concat!("Version: ", env!("CARGO_PKG_VERSION")));

    let config = Config::from_env();
    log_info("main", &format!("Config: {}", config.summary()));

    // Spawn the RPC server on a background thread so the loader loop
    // can run concurrently without blocking on incoming connections.
    let rpc_addr = config.rpc_addr.clone();
    std::thread::spawn(move || rpc::serve(&rpc_addr));

    loader::run(config);
}
