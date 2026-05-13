use std::process::Command;
use std::thread;
use std::time::Duration;

use crate::logger::{log_error, log_info, log_warning};

const BUNDLE_PATH: &str = "/opt/shelves-loader/bundle/index.js";
const CHECK_INTERVAL_SECS: u64 = 30;

pub fn run() {
    log_info("loader", "Injection loop started.");

    loop {
        if is_injected() {
            log_info("loader", "Bundle already active — skipping injection.");
        } else {
            log_warning("loader", "Bundle not detected. Attempting injection...");
            inject_bundle();
        }

        thread::sleep(Duration::from_secs(CHECK_INTERVAL_SECS));
    }
}

fn is_injected() -> bool {
    // TODO: replace this placeholder with a real CEF/WebSocket probe that
    // checks whether the DS bundle is already executing inside the Steam
    // Big Picture renderer process.
    log_info("loader", "[placeholder] injection check — always returns false");
    false
}

fn inject_bundle() {
    log_info("loader", &format!("Injecting bundle: {BUNDLE_PATH}"));

    let result = Command::new("sh")
        .arg("-c")
        .arg(format!("inject_bundle_file {BUNDLE_PATH}"))
        .status();

    match result {
        Ok(status) if status.success() => {
            log_info("loader", "Bundle injected successfully.");
        }
        Ok(status) => {
            log_error("loader", &format!("Injection process exited with status: {status}"));
        }
        Err(e) => {
            log_error("loader", &format!("Failed to spawn injection command: {e}"));
        }
    }
}
