//! Bundle "populate" — obtain the Deck Shelves bundle when it isn't already
//! present locally, so the sole-host case (no plugin loader, no local bundle)
//! can still bring Deck Shelves up on its own.
//!
//! The daemon injects the bundle with `Runtime.evaluate` (as a script), so it
//! needs the self-executing **IIFE** (`index.iife.js`), not the ES `index.js`.
//!
//! Resolution order:
//!   1. **local** — the configured bundle path, if it holds a real bundle (not
//!      the tiny placeholder shipped in the package).
//!   2. **copy from a loader** — a plugin loader keeps its built copy at
//!      `~/homebrew/plugins/deck-shelves/dist/index.iife.js`; copy it if present.
//!   3. **download** — fetch the newest `*.iife.js` asset from the Deck Shelves
//!      GitHub releases (via `curl`, so no HTTP/TLS crate is pulled in).
//!
//! Everything here is best-effort: on failure the caller keeps whatever is at
//! the path and injection reports the miss — it never panics.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::logger::{log_error, log_info};

/// A file below this size is treated as absent/placeholder rather than a real
/// bundle. The shipped placeholder is ~68 bytes; a real Deck Shelves IIFE is
/// multiple megabytes, so any small file (placeholder or a truncated download)
/// falls through to the next source.
const REAL_BUNDLE_MIN_BYTES: u64 = 4096;

/// A plugin loader's install path of the injectable artifact, relative to `$HOME`.
/// (Note: a loader *release* `.zip` currently excludes the IIFE — only a dev deploy
/// that copies the whole `dist/` has it — so step 3 is the reliable path for end
/// users once the plugin publishes the IIFE as a release asset.)
const LOADER_IIFE_REL: &str = "homebrew/plugins/deck-shelves/dist/index.iife.js";

/// GitHub API for the newest stable Deck Shelves release. Unauthenticated (60
/// req/h) — fine for an occasional populate.
const RELEASES_LATEST_URL: &str =
    "https://api.github.com/repos/santojon/Deck-Shelves/releases/latest";

/// GitHub API listing all releases, newest first, INCLUDING pre-releases — used
/// when the pre-release channel is enabled (the plugin's beta channel equivalent).
const RELEASES_ALL_URL: &str = "https://api.github.com/repos/santojon/Deck-Shelves/releases";

/// Ensure `dest` holds a real Deck Shelves bundle, obtaining it if needed.
/// `prerelease` widens the download step to pre-release releases. Returns a short
/// description of where the bundle came from, or an error message.
pub fn ensure_bundle(dest: &Path, prerelease: bool) -> Result<String, String> {
    // 1. Local.
    if is_real_bundle(dest) {
        return Ok(format!("local ({})", dest.display()));
    }

    // 2. Copy from an installed plugin loader.
    if let Some(src) = loader_iife_path() {
        if is_real_bundle(&src) {
            copy_into(&src, dest)?;
            log_info(
                "populate",
                &format!(
                    "Copied bundle from an existing loader install: {}",
                    src.display()
                ),
            );
            return Ok(format!(
                "copied from an existing loader install ({})",
                src.display()
            ));
        }
    }

    // 3. Download the newest IIFE from the releases.
    log_info(
        "populate",
        "No local bundle and no loader copy — downloading from Deck Shelves releases.",
    );
    let url = download_latest_iife(dest, prerelease)?;
    Ok(format!("downloaded ({url})"))
}

/// A file that exists and is larger than a placeholder.
fn is_real_bundle(p: &Path) -> bool {
    fs::metadata(p)
        .map(|m| m.is_file() && m.len() >= REAL_BUNDLE_MIN_BYTES)
        .unwrap_or(false)
}

/// `$HOME/homebrew/plugins/deck-shelves/dist/index.iife.js`, if it exists.
fn loader_iife_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let p = Path::new(&home).join(LOADER_IIFE_REL);
    p.exists().then_some(p)
}

fn copy_into(src: &Path, dest: &Path) -> Result<(), String> {
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    }
    fs::copy(src, dest)
        .map(|_| ())
        .map_err(|e| format!("copy {} -> {}: {e}", src.display(), dest.display()))
}

/// Resolve the newest release's `*.iife.js` asset and download it to `dest`. When
/// `prerelease` is set, pre-release releases are considered (newest overall);
/// otherwise only the latest stable release.
fn download_latest_iife(dest: &Path, prerelease: bool) -> Result<String, String> {
    let url = if prerelease {
        let api = curl_text(RELEASES_ALL_URL)?;
        find_newest_iife_in_releases(&api)
            .ok_or_else(|| "no `*.iife.js` asset in any release (publish it there)".to_string())?
    } else {
        let api = curl_text(RELEASES_LATEST_URL)?;
        find_iife_asset_url(&api).ok_or_else(|| {
            "no `*.iife.js` asset in the latest release (publish it there)".to_string()
        })?
    };
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    }
    curl_download(&url, dest)?;
    if !is_real_bundle(dest) {
        return Err(format!(
            "downloaded file at {} is too small",
            dest.display()
        ));
    }
    log_info("populate", &format!("Downloaded bundle from {url}"));
    Ok(url)
}

/// The `browser_download_url` of the first `*.iife.js` asset in one release object.
fn iife_asset_url(release: &serde_json::Value) -> Option<String> {
    for asset in release.get("assets")?.as_array()? {
        let name = asset.get("name").and_then(|n| n.as_str()).unwrap_or("");
        if name.ends_with(".iife.js") {
            return asset
                .get("browser_download_url")
                .and_then(|u| u.as_str())
                .map(str::to_owned);
        }
    }
    None
}

/// The `*.iife.js` asset URL of a single release JSON body (`releases/latest`).
fn find_iife_asset_url(release_json: &str) -> Option<String> {
    let release: serde_json::Value = serde_json::from_str(release_json).ok()?;
    iife_asset_url(&release)
}

/// The `*.iife.js` asset URL of the newest non-draft release in a `releases`
/// array (the API returns them newest first), so pre-releases are considered.
fn find_newest_iife_in_releases(releases_json: &str) -> Option<String> {
    let releases: serde_json::Value = serde_json::from_str(releases_json).ok()?;
    for release in releases.as_array()? {
        if release.get("draft").and_then(serde_json::Value::as_bool) == Some(true) {
            continue; // never publish from a draft
        }
        if let Some(url) = iife_asset_url(release) {
            return Some(url);
        }
    }
    None
}

/// `curl -sL <url>` → stdout as text. Used for the GitHub API call.
fn curl_text(url: &str) -> Result<String, String> {
    let out = Command::new("curl")
        .args(["-sL", "-H", "Accept: application/vnd.github+json", url])
        .output()
        .map_err(|e| format!("curl (is it installed?): {e}"))?;
    if !out.status.success() {
        return Err(format!("curl exit {:?} for {url}", out.status.code()));
    }
    String::from_utf8(out.stdout).map_err(|e| format!("curl output not UTF-8: {e}"))
}

/// `curl -sL <url> -o <dest>` — download a file.
fn curl_download(url: &str, dest: &Path) -> Result<(), String> {
    let status = Command::new("curl")
        .args(["-fsSL", url, "-o"])
        .arg(dest)
        .status()
        .map_err(|e| format!("curl (is it installed?): {e}"))?;
    if !status.success() {
        let _ = fs::remove_file(dest);
        return Err(format!("curl exit {:?} downloading {url}", status.code()));
    }
    Ok(())
}

/// Force-obtain the newest release IIFE into `dest`, ignoring any local copy.
/// Used by the host "apply update" path — always fetches the published release
/// (`prerelease` widens it to the beta channel).
pub fn update_from_release(dest: &Path, prerelease: bool) -> Result<String, String> {
    match download_latest_iife(dest, prerelease) {
        Ok(url) => Ok(url),
        Err(e) => {
            log_error("populate", &format!("update download failed: {e}"));
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_iife_asset_url() {
        let json = r#"{"assets":[
            {"name":"deck-shelves-v1.zip","browser_download_url":"https://x/zip"},
            {"name":"index.iife.js","browser_download_url":"https://x/index.iife.js"}
        ]}"#;
        assert_eq!(
            find_iife_asset_url(json).as_deref(),
            Some("https://x/index.iife.js")
        );
    }

    #[test]
    fn no_iife_asset_returns_none() {
        let json =
            r#"{"assets":[{"name":"deck-shelves.zip","browser_download_url":"https://x/zip"}]}"#;
        assert!(find_iife_asset_url(json).is_none());
    }

    #[test]
    fn newest_non_draft_iife_wins_including_prerelease() {
        // Releases newest-first: the draft is skipped, then the newest non-draft
        // with an iife asset wins — a pre-release counts under the beta channel.
        let json = r#"[
            {"draft":true,"prerelease":false,"assets":[{"name":"index.iife.js","browser_download_url":"https://x/draft.iife.js"}]},
            {"draft":false,"prerelease":true,"assets":[{"name":"index.iife.js","browser_download_url":"https://x/beta.iife.js"}]},
            {"draft":false,"prerelease":false,"assets":[{"name":"index.iife.js","browser_download_url":"https://x/stable.iife.js"}]}
        ]"#;
        assert_eq!(
            find_newest_iife_in_releases(json).as_deref(),
            Some("https://x/beta.iife.js")
        );
    }

    #[test]
    fn placeholder_is_not_a_real_bundle() {
        let dir = std::env::temp_dir().join("shelveshub-populate-test");
        let _ = fs::create_dir_all(&dir);
        let p = dir.join("placeholder.js");
        fs::write(&p, b"// placeholder\n").unwrap();
        assert!(!is_real_bundle(&p));
        fs::write(&p, vec![b'x'; 8192]).unwrap();
        assert!(is_real_bundle(&p));
        let _ = fs::remove_file(&p);
    }
}
