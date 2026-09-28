//! Build script: derive `HOST_API_VERSION` from the shared `@deck-shelves/host`
//! contract so the daemon never hardcodes a value that could drift from it. The
//! committed source of truth is `host/src/contract/index.ts`; the built
//! `host/dist/index.d.ts` is used as a secondary source when present.
//!
//! A RELEASE build FAILS when neither is found (the submodule isn't checked out)
//! — shipping a wrong compatibility number is worse than a red build. A debug
//! build falls back to a baseline so a dev checkout without the submodule still
//! compiles.

use std::fs;

const CONTRACT_SRC: &str = "host/src/contract/index.ts";
const CONTRACT_DTS: &str = "host/dist/index.d.ts";
const FALLBACK: &str = "1.1.0";

fn main() {
    println!("cargo:rerun-if-changed={CONTRACT_SRC}");
    println!("cargo:rerun-if-changed={CONTRACT_DTS}");
    let version = read_version(CONTRACT_SRC)
        .or_else(|| read_version(CONTRACT_DTS))
        .unwrap_or_else(missing_contract);
    println!("cargo:rustc-env=SHELVES_HOST_API_VERSION={version}");
}

fn read_version(path: &str) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| extract_version(&s))
}

/// No contract in the tree. Fail a release build (CI fetches the submodule); let a
/// debug build proceed on the baseline so a submodule-less dev checkout still works.
fn missing_contract() -> String {
    let is_release = std::env::var("PROFILE").as_deref() == Ok("release");
    if is_release {
        panic!(
            "@deck-shelves/host contract not found ({CONTRACT_SRC} or {CONTRACT_DTS}). \
             Run `git submodule update --init --recursive` before a release build."
        );
    }
    println!(
        "cargo:warning=@deck-shelves/host contract missing — using fallback \
         HOST_API_VERSION {FALLBACK} (debug build only; a release build fails here)."
    );
    FALLBACK.to_string()
}

/// Pull the quoted version out of `HOST_API_VERSION = "X.Y.Z"` (source `export
/// const …` or built `declare const … :`).
fn extract_version(src: &str) -> Option<String> {
    let line = src.lines().find(|l| l.contains("HOST_API_VERSION"))?;
    let mut parts = line.split('"');
    parts.next()?; // before the first quote
    let v = parts.next()?; // between the first pair of quotes
    (!v.is_empty()).then(|| v.to_string())
}
