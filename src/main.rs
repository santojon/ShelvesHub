mod logger;
mod loader;
mod rpc;

use logger::log_info;

fn main() {
    log_info("main", "Shelves Loader starting...");
    log_info("main", concat!("Version: ", env!("CARGO_PKG_VERSION")));

    // Spawn the RPC server on a background thread so the loader loop
    // can run concurrently without blocking on incoming connections.
    std::thread::spawn(rpc::serve);

    loader::run();
}
