//! Build script: derive `HOST_API_VERSION` from the shared `@deck-shelves/host`
//! contract (`host/dist/index.d.ts`) so the daemon never hardcodes a value that
//! could drift from the contract. Falls back to a baseline if the submodule is
//! not checked out (e.g. a shallow clone without submodules) — CI fetches it.

use std::fs;

const CONTRACT_DTS: &str = "host/dist/index.d.ts";
const FALLBACK: &str = "1.1.0";

fn main() {
    println!("cargo:rerun-if-changed={CONTRACT_DTS}");
    let version = fs::read_to_string(CONTRACT_DTS)
        .ok()
        .and_then(|s| extract_version(&s))
        .unwrap_or_else(|| FALLBACK.to_string());
    println!("cargo:rustc-env=SHELVES_HOST_API_VERSION={version}");
}

/// Pull the quoted version out of `declare const HOST_API_VERSION: "X.Y.Z";`.
fn extract_version(src: &str) -> Option<String> {
    let line = src.lines().find(|l| l.contains("HOST_API_VERSION"))?;
    let mut parts = line.split('"');
    parts.next()?; // before the first quote
    let v = parts.next()?; // between the first pair of quotes
    (!v.is_empty()).then(|| v.to_string())
}
