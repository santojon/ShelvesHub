use std::process::Command;
use std::thread;
use std::time::Duration;

fn main() {
    println!("Starting Shelves Loader...");

    loop {
        if !is_injected() {
            println!("Deck Shelves not loaded. Attempting injection...");
            inject_bundle();
        }
        thread::sleep(Duration::from_secs(30));
    }
}

fn is_injected() -> bool {
    println!("[DEBUG] Placeholder for injection check.");
    false
}

fn inject_bundle() {
    let bundle_path = "/opt/shelves-loader/bundle/index.js";

    match Command::new("sh")
        .arg("-c")
        .arg(format!("inject_bundle_file {}", bundle_path))
        .status()
    {
        Ok(_) => println!("Bundle injected successfully!"),
        Err(e) => eprintln!("Error injecting bundle: {:?}", e),
    }
}